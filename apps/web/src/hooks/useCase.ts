import type { CaseDetail, GapState, Speaker } from "@innoverse/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { ClientError, userMessage } from "../lib/errors";
import { readPreference, writePreference } from "../lib/storage";

const POLL_MS = 1_200;

/** Remembers the open case per browser; creates one when there is none. */
export function useCurrentCaseId() {
	const [caseId, setCaseId] = useState<string | null>(() => readPreference("caseId"));
	const [error, setError] = useState<string | null>(null);

	const open = useCallback((id: string) => {
		writePreference("caseId", id);
		setCaseId(id);
	}, []);

	const createNew = useCallback(async () => {
		try {
			const created = await api.createCase();
			open(created.id);
			setError(null);
		} catch (err) {
			setError(userMessage(err));
		}
	}, [open]);

	useEffect(() => {
		if (caseId) return;
		api.createCase().then(
			created => open(created.id),
			err => setError(userMessage(err))
		);
	}, [caseId, open]);

	return { caseId, open, createNew, error };
}

/**
 * Case state from the server. Polls a cheap version endpoint and refetches the whole
 * case only when something changed (new line, finished analysis, edits elsewhere).
 */
export function useCase(caseId: string, onMissing: () => void) {
	const [detail, setDetail] = useState<CaseDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const version = useRef<number | null>(null);
	const onMissingRef = useRef(onMissing);

	useEffect(() => {
		onMissingRef.current = onMissing;
	}, [onMissing]);

	const reload = useCallback(
		() =>
			api.getCase(caseId).then(
				next => {
					version.current = next.version;
					setDetail(next);
					setError(null);
				},
				(err: unknown) => {
					if (err instanceof ClientError && err.code === "NOT_FOUND") onMissingRef.current();
					else setError(userMessage(err));
				}
			),
		[caseId]
	);

	// The workspace is keyed by case id, so state starts empty for every case.
	useEffect(() => {
		let active = true;
		api.getCase(caseId).then(
			next => {
				if (!active) return;
				version.current = next.version;
				setDetail(next);
			},
			() => active && void reload()
		);
		const timer = window.setInterval(() => {
			if (document.hidden) return;
			api.caseVersion(caseId).then(
				next => {
					if (active && next !== version.current) void reload();
				},
				() => undefined
			);
		}, POLL_MS);
		return () => {
			active = false;
			window.clearInterval(timer);
		};
	}, [caseId, reload]);

	/** Run a mutation, apply an optimistic update, then resync. */
	const mutate = useCallback(
		async (action: () => Promise<unknown>, optimistic?: (current: CaseDetail) => CaseDetail) => {
			if (optimistic) setDetail(current => (current ? optimistic(current) : current));
			try {
				await action();
				setError(null);
			} catch (err) {
				setError(userMessage(err));
			} finally {
				await reload();
			}
		},
		[reload]
	);

	const setSpeaker = useCallback(
		(lineId: string, speaker: Speaker) =>
			mutate(
				() => api.setSpeaker(caseId, lineId, speaker),
				current => ({
					...current,
					utterances: current.utterances.map(line => (line.id === lineId ? { ...line, speaker, speakerSource: "manual", speakerUncertain: false } : line))
				})
			),
		[caseId, mutate]
	);

	const setGapState = useCallback(
		(gapId: string, state: GapState) =>
			mutate(
				() => api.setGapState(caseId, gapId, state),
				current =>
					current.analysis
						? {
								...current,
								analysis: {
									...current.analysis,
									blocks: current.analysis.blocks.map(block => ({ ...block, gaps: block.gaps.map(gap => (gap.id === gapId ? { ...gap, state } : gap)) }))
								}
							}
						: current
			),
		[caseId, mutate]
	);

	const editFact = useCallback(
		(factId: string, text: string | null) =>
			mutate(
				() => api.editFact(caseId, factId, text),
				current =>
					current.analysis
						? {
								...current,
								analysis: {
									...current.analysis,
									blocks: current.analysis.blocks.map(block => ({
										...block,
										facts: block.facts.map(fact => {
											if (fact.id !== factId) return fact;
											if (text === null) return { ...fact, text: fact.original ?? fact.text, original: null };
											return { ...fact, text, original: fact.original ?? fact.text };
										})
									}))
								}
							}
						: current
			),
		[caseId, mutate]
	);

	const analyze = useCallback(() => mutate(() => api.analyze(caseId)), [caseId, mutate]);

	return { detail, error, setError, reload, setSpeaker, setGapState, editFact, analyze };
}
