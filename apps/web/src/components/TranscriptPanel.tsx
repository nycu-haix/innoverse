import { SPEAKER_LABELS, type Speaker, type TaskStatus, type Utterance } from "@innoverse/shared";
import { AlertTriangle, ArrowLeftRight, Mic, Play, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { clock } from "../lib/time";

type Props = {
	caseId: string;
	utterances: Utterance[];
	/** Utterances uploaded or being transcribed. */
	pending: number;
	speaking: boolean;
	highlight: { lines: string[]; scroll: boolean };
	analysisStatus: TaskStatus;
	onToggleSpeaker: (lineId: string, speaker: Speaker) => void;
	onRetryAnalysis: () => void;
};

function LiveLine({ label }: { label: string }) {
	return (
		<div className="ln">
			<span className="ts" />
			<div>
				<div className="who">
					<span className="spk live">{label}</span>
				</div>
				<div className="say typing" aria-label={label}>
					<i />
					<i />
					<i />
				</div>
			</div>
		</div>
	);
}

export function TranscriptPanel({ caseId, utterances, pending, speaking, highlight, analysisStatus, onToggleSpeaker, onRetryAnalysis }: Props) {
	const scroller = useRef<HTMLDivElement>(null);
	const nearBottom = useRef(true);
	const audio = useRef<HTMLAudioElement | null>(null);
	const [playing, setPlaying] = useState<string | null>(null);
	const highlighted = new Set(highlight.lines);

	// Follow new lines only when the officer is already at the bottom.
	useLayoutEffect(() => {
		const element = scroller.current;
		if (element && nearBottom.current) element.scrollTop = element.scrollHeight;
	}, [utterances.length, pending, speaking]);

	useEffect(() => {
		const first = highlight.lines[0];
		if (!highlight.scroll || !first) return;
		document.getElementById(`tx-${first}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [highlight]);

	useEffect(() => () => audio.current?.pause(), []);

	const play = (lineId: string) => {
		audio.current?.pause();
		if (playing === lineId) {
			setPlaying(null);
			return;
		}
		const element = new Audio(api.audioUrl(caseId, lineId));
		element.onended = () => setPlaying(null);
		element.onerror = () => setPlaying(null);
		audio.current = element;
		setPlaying(lineId);
		void element.play().catch(() => setPlaying(null));
	};

	const busy = analysisStatus.state === "queued" || analysisStatus.state === "running";

	return (
		<aside className="side" aria-label="即時逐字稿">
			<div className="side-h">
				<Mic size={15} />
				即時逐字稿
				<span className="count">{utterances.length}</span>
				{busy && (
					<span className="status" role="status">
						<span className="spin" />
						整理中
					</span>
				)}
			</div>
			{analysisStatus.state === "error" && (
				<div className="notice" role="alert">
					<AlertTriangle size={13} />
					{analysisStatus.error?.message}
					<button type="button" className="btn" onClick={onRetryAnalysis}>
						重試
					</button>
				</div>
			)}
			<div
				className="tx"
				ref={scroller}
				onScroll={event => {
					const element = event.currentTarget;
					nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
				}}
			>
				{utterances.map(line => {
					const next: Speaker = line.speaker === "officer" ? "victim" : "officer";
					return (
						<div className={`ln${highlighted.has(line.id) ? " hl" : ""}`} id={`tx-${line.id}`} key={line.id}>
							<span className="ts">{clock(line.startedAt)}</span>
							<div>
								<div className="who">
									<button type="button" className={`spk${line.speaker === "victim" ? " v" : ""}`} onClick={() => onToggleSpeaker(line.id, next)} title={`改為${SPEAKER_LABELS[next]}`}>
										{SPEAKER_LABELS[line.speaker]}
										<ArrowLeftRight size={9} strokeWidth={3} />
									</button>
									{line.speakerUncertain && line.speakerSource === "ai" && (
										<span className="lowc">
											<AlertTriangle size={11} />
											說話者可能標錯
										</span>
									)}
									{line.speakerSource === "manual" && <span className="fixed">✓ 已更正</span>}
									{line.hasAudio && (
										<button type="button" className="play" onClick={() => play(line.id)} aria-label={playing === line.id ? "停止播放" : "播放原始錄音"}>
											{playing === line.id ? <Square size={11} /> : <Play size={12} />}
										</button>
									)}
								</div>
								<div className="say">{line.text}</div>
							</div>
						</div>
					);
				})}
				{Array.from({ length: pending }, (_, index) => (
					<LiveLine key={`pending-${index}`} label="辨識中" />
				))}
				{speaking && <LiveLine label="收音中" />}
			</div>
		</aside>
	);
}
