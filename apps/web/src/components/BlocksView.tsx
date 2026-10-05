import { BLOCK_STATUS_LABELS, GAP_LEVEL_LABELS, SPEAKER_LABELS, stripMarkup, type Analysis, type Block, type Fact, type Gap, type GapState, type Utterance } from "@innoverse/shared";
import { AlertTriangle, ArrowLeftRight, Calculator, Check, ChevronDown, Circle, CircleAlert, Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { diffChars } from "../lib/diff";
import { renderMarkupInto } from "../lib/markup-dom";
import { clock } from "../lib/time";
import { ACTIONS_ANCHOR, CONFLICTS_ANCHOR } from "./FlowRail";
import { Popover } from "./Popover";

const LEVEL_ORDER = { must: 0, lead: 1, add: 2 } as const;
/** Suggestions shown expanded while interviewing; the rest stay collapsed. */
const TOP_SUGGESTIONS = 3;

type Highlight = (lines: string[], scroll: boolean) => void;

type Props = {
	analysis: Analysis;
	utterances: Utterance[];
	onGapState: (gapId: string, state: GapState) => void;
	onEditFact: (factId: string, text: string | null) => void;
	onHighlight: Highlight;
	onActive: (anchorId: string) => void;
	scrollRoot: HTMLElement | null;
};

function StatusPill({ block }: { block: Block }) {
	const Icon = block.status === "ok" ? Check : block.status === "pending" ? CircleAlert : Circle;
	return (
		<span className={`pill ${block.status}`}>
			<Icon size={12} strokeWidth={block.status === "ok" ? 3 : 2.5} strokeDasharray={block.status === "missing" ? "3 3" : undefined} />
			{BLOCK_STATUS_LABELS[block.status]}
		</span>
	);
}

function LevelTag({ gap }: { gap: Gap }) {
	return <span className={`lv ${gap.level}`}>{GAP_LEVEL_LABELS[gap.level]}</span>;
}

function SourceLines({ lines }: { lines: Utterance[] }) {
	return lines.map(line => (
		<div className="ln" key={line.id}>
			<span className="ts">{clock(line.startedAt)}</span>
			<div>
				<div className="who">
					<span className={`spk${line.speaker === "victim" ? " v" : ""}`}>{SPEAKER_LABELS[line.speaker]}</span>
					{line.speakerSource === "manual" && <span className="fixed">✓ 說話者已更正</span>}
				</div>
				<div className="say">{line.text}</div>
			</div>
		</div>
	));
}

function DiffView({ before, after }: { before: string; after: string }) {
	const parts = diffChars(before, after);
	return (
		<div className="diff">
			<div>
				<span className="lbl">AI 整理</span>
				{parts.map((part, index) => (part.op === "+" ? null : part.op === "-" ? <del key={index}>{part.text}</del> : <span key={index}>{part.text}</span>))}
			</div>
			<div>
				<span className="lbl">目前</span>
				{parts.map((part, index) => (part.op === "-" ? null : part.op === "+" ? <ins key={index}>{part.text}</ins> : <span key={index}>{part.text}</span>))}
			</div>
		</div>
	);
}

/** Inline-editable fact text. The DOM is only replaced while the field is not focused. */
function FactText({ fact, onCommit, onFocus, onBlur }: { fact: Fact; onCommit: (text: string) => void; onFocus: () => void; onBlur: () => void }) {
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (element && document.activeElement !== element) renderMarkupInto(element, fact.text);
	}, [fact.text]);

	return (
		<div
			ref={ref}
			className="txt"
			contentEditable="plaintext-only"
			spellCheck={false}
			role="textbox"
			aria-label="案情內容"
			onFocus={onFocus}
			onBlur={event => {
				const value = (event.currentTarget.textContent ?? "").replace(/\s+/g, " ").trim();
				if (value && value !== stripMarkup(fact.text)) onCommit(value);
				else renderMarkupInto(event.currentTarget, fact.text);
				onBlur();
			}}
			onKeyDown={event => {
				if (event.key === "Enter") {
					event.preventDefault();
					event.currentTarget.blur();
				} else if (event.key === "Escape") {
					renderMarkupInto(event.currentTarget, fact.text);
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

function Suggestion({ gap, rank, onState, from }: { gap: Gap; rank: number | null; onState: (state: GapState) => void; from?: string }) {
	const [expanded, setExpanded] = useState(false);
	const compact = gap.state === "open" && rank === null;
	const showDetail = gap.state === "open" && (!compact || expanded);
	return (
		<div className={`ghost${gap.state !== "open" ? ` ${gap.state}` : compact ? " compact" : ""}`} data-gap={gap.id}>
			<div className="g1">
				{rank !== null && gap.state === "open" && <span className="rank">#{rank}</span>}
				<LevelTag gap={gap} />
				<span className="field">{gap.field}</span>
				{gap.state === "asked" && <span className="stmsg">已問</span>}
				{gap.state === "skipped" && <span className="stmsg">已略過</span>}
				{from && <span className="stmsg">{from}</span>}
				{compact && (
					<button type="button" className="expand" onClick={() => setExpanded(value => !value)}>
						{expanded ? "收合" : "顯示追問"}
					</button>
				)}
				<span className="acts">
					{gap.state === "open" ? (
						<>
							<button type="button" className="btn pri" onClick={() => onState("asked")}>
								已問
							</button>
							<button type="button" className="btn quiet" onClick={() => onState("skipped")}>
								略過
							</button>
						</>
					) : (
						<button type="button" className="btn quiet" onClick={() => onState("open")}>
							復原
						</button>
					)}
				</span>
			</div>
			{showDetail && (
				<dl className="detail">
					<dt>建議追問</dt>
					<dd className="q">「{gap.question}」</dd>
					<dt>為什麼要問</dt>
					<dd>{gap.reason}</dd>
					<dt>偵查用途</dt>
					<dd>{gap.use}</dd>
					<dt>判斷依據</dt>
					<dd>{gap.basis}</dd>
				</dl>
			)}
		</div>
	);
}

type PopState = { kind: "source" | "diff"; fact: Fact; anchor: HTMLElement; pinned: boolean };

export function BlocksView({ analysis, utterances, onGapState, onEditFact, onHighlight, onActive, scrollRoot }: Props) {
	const lines = useMemo(() => new Map(utterances.map(line => [line.id, line])), [utterances]);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [pop, setPop] = useState<PopState | null>(null);
	const [scrollTick, setScrollTick] = useState(0);
	const hideTimer = useRef<number | undefined>(undefined);

	const ranks = useMemo(() => {
		const open = analysis.blocks.flatMap(block => block.gaps).filter(gap => gap.state === "open");
		open.sort((a, b) => a.priority - b.priority || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
		return new Map(open.slice(0, TOP_SUGGESTIONS).map((gap, index) => [gap.id, index + 1]));
	}, [analysis]);

	// Heat colouring: older sources pale, recent sources saturated (like git blame age).
	const heat = useMemo(() => {
		const times = utterances.map(line => Date.parse(line.startedAt));
		const first = Math.min(...times);
		const span = Math.max(1, Math.max(...times) - first);
		return (iso: string) => {
			const ratio = Math.max(0, Math.min(1, (Date.parse(iso) - first) / span));
			return { "--heat-bg": `hsl(36, ${55 + 30 * ratio}%, ${97 - 14 * ratio}%)`, "--heat-bar": `hsl(30, ${60 + 30 * ratio}%, ${78 - 30 * ratio}%)` } as CSSProperties;
		};
	}, [utterances]);

	const sourcesOf = (fact: Fact) => fact.sources.map(id => lines.get(id)).filter((line): line is Utterance => line !== undefined);
	/** The victim's statement is the primary source; otherwise the latest line. */
	const mainSource = (fact: Fact) => {
		const sources = sourcesOf(fact);
		return sources.filter(line => line.speaker === "victim").at(-1) ?? sources.at(-1) ?? null;
	};

	const unpin = () => {
		setPop(null);
		onHighlight([], false);
	};

	const showSoon = (next: PopState) => {
		window.clearTimeout(hideTimer.current);
		setPop(current => (current?.pinned ? current : next));
	};
	const hideSoon = () => {
		window.clearTimeout(hideTimer.current);
		hideTimer.current = window.setTimeout(() => setPop(current => (current?.pinned ? current : null)), 220);
	};

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setPop(null);
				onHighlight([], false);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onHighlight]);

	// Pinned popovers follow the row while scrolling; hover popovers close.
	useEffect(() => {
		if (!scrollRoot) return;
		const onScroll = () => {
			setPop(current => (current?.pinned ? current : null));
			setScrollTick(tick => tick + 1);
		};
		scrollRoot.addEventListener("scroll", onScroll, { passive: true });
		return () => scrollRoot.removeEventListener("scroll", onScroll);
	}, [scrollRoot]);

	// Keep the outline in sync with the block at the top of the editor.
	useEffect(() => {
		if (!scrollRoot) return;
		const observer = new IntersectionObserver(
			entries => {
				for (const entry of entries) if (entry.isIntersecting) onActive(entry.target.id);
			},
			{ root: scrollRoot, rootMargin: "-20% 0px -70% 0px" }
		);
		scrollRoot.querySelectorAll(".block, .card").forEach(element => observer.observe(element));
		return () => observer.disconnect();
	}, [scrollRoot, analysis, onActive]);

	const factRow = (fact: Fact) => {
		const source = mainSource(fact);
		const more = fact.sources.length - 1;
		const pinned = pop?.pinned === true && pop.kind === "source" && pop.fact.id === fact.id;
		return (
			<div className={`row${pinned ? " linked" : ""}`} key={fact.id}>
				{source ? (
					<button
						type="button"
						className={`gut${pinned ? " pinned" : ""}`}
						style={heat(source.startedAt)}
						aria-label="原話來源"
						onPointerEnter={event => showSoon({ kind: "source", fact, anchor: event.currentTarget, pinned: false })}
						onPointerLeave={hideSoon}
						onClick={event => {
							if (pinned) return unpin();
							setPop({ kind: "source", fact, anchor: event.currentTarget, pinned: true });
							onHighlight(fact.sources, true);
						}}
					>
						{clock(source.startedAt)}
						<span className={`sp${source.speaker === "victim" ? " v" : ""}`}>{source.speaker === "victim" ? "被" : "員"}</span>
						{more > 0 && <span className="more">+{more}</span>}
					</button>
				) : (
					<div className="gut sys">
						<Calculator size={12} />
						系統計算
					</div>
				)}
				<FactText
					fact={fact}
					onCommit={text => onEditFact(fact.id, text)}
					onFocus={() => {
						if (!pop?.pinned) onHighlight(fact.sources, true);
					}}
					onBlur={() => {
						if (!pop?.pinned) onHighlight([], false);
					}}
				/>
				<div className="meta">
					{fact.status === "pending" && (
						<span className="tag pending" title={fact.note ?? undefined}>
							<CircleAlert size={12} />
							待確認
						</span>
					)}
					{fact.verifyWith && (
						<span className="tag verify" title={`請以被害人提供的${fact.verifyWith}核對`}>
							核對：{fact.verifyWith}
						</span>
					)}
					{fact.original !== null && (
						<button
							type="button"
							className="tag edited"
							onPointerEnter={event => showSoon({ kind: "diff", fact, anchor: event.currentTarget, pinned: false })}
							onPointerLeave={hideSoon}
							onClick={event => setPop({ kind: "diff", fact, anchor: event.currentTarget, pinned: true })}
						>
							<Pencil size={10} />
							已修改
						</button>
					)}
				</div>
			</div>
		);
	};

	let index = 0;
	const blocks = analysis.blocks.map(block => {
		const isSummary = block.kind === "summary";
		if (!isSummary) index++;
		const open = block.gaps.filter(gap => gap.state === "open").length;
		const gaps = [...block.gaps].sort((a, b) => a.priority - b.priority);
		const isCollapsed = collapsed.has(block.id);
		return (
			<article className={`block${isCollapsed ? " collapsed" : ""}`} id={block.id} key={block.id}>
				<div className="bh">
					<button
						type="button"
						className="caret"
						aria-expanded={!isCollapsed}
						aria-label="收合／展開"
						onClick={() =>
							setCollapsed(current => {
								const next = new Set(current);
								if (next.has(block.id)) next.delete(block.id);
								else next.add(block.id);
								return next;
							})
						}
					>
						<ChevronDown size={14} />
					</button>
					<span className="idx">{isSummary ? "Σ" : String(index).padStart(2, "0")}</span>
					<h3>
						{block.title}
						{block.subtitle && <small>{block.subtitle}</small>}
					</h3>
					<div className="right">
						{open > 0 && <span className="cnt">缺 {open}</span>}
						<StatusPill block={block} />
					</div>
				</div>
				<div className="rows">
					{block.facts.map(factRow)}
					{gaps.map(gap => (
						<Suggestion key={gap.id} gap={gap} rank={ranks.get(gap.id) ?? null} onState={state => onGapState(gap.id, state)} />
					))}
				</div>
			</article>
		);
	});

	let popover: ReactNode = null;
	if (pop?.anchor.isConnected) {
		const close = () => (pop.kind === "source" ? unpin() : setPop(null));
		const keep = () => window.clearTimeout(hideTimer.current);
		const leave = () => {
			if (!pop.pinned) hideSoon();
		};
		popover =
			pop.kind === "source" ? (
				<Popover
					anchor={pop.anchor}
					pinned={pop.pinned}
					layoutKey={scrollTick}
					onClose={close}
					onPointerEnter={keep}
					onPointerLeave={leave}
					title={
						<span>
							<b>原話來源</b> ・ {pop.fact.sources.length} 段逐字稿
						</span>
					}
				>
					<SourceLines lines={sourcesOf(pop.fact)} />
				</Popover>
			) : (
				<Popover
					anchor={pop.anchor}
					pinned={pop.pinned}
					layoutKey={scrollTick}
					onClose={close}
					onPointerEnter={keep}
					onPointerLeave={leave}
					title={<b>修改紀錄</b>}
					footer={
						<button
							type="button"
							className="btn"
							onClick={() => {
								setPop(null);
								onEditFact(pop.fact.id, null);
							}}
						>
							還原為 AI 整理
						</button>
					}
				>
					<DiffView before={stripMarkup(pop.fact.original ?? "")} after={pop.fact.text} />
				</Popover>
			);
	}

	return (
		<>
			{blocks}
			{analysis.conflicts.length > 0 && (
				<section className="card conflict" id={CONFLICTS_ANCHOR}>
					<div className="card-h">
						<ArrowLeftRight size={14} />
						矛盾提示
					</div>
					<div className="card-b">
						{analysis.conflicts.map(conflict => (
							<div className="conflict-item" key={conflict.id}>
								<b>{conflict.title}</b>
								<p>{conflict.detail}</p>
								<div className="srcs">
									{conflict.sources.map(id => {
										const line = lines.get(id);
										return line ? (
											<button type="button" className="srcbtn" key={id} onClick={() => onHighlight([id], true)}>
												{clock(line.startedAt)} {SPEAKER_LABELS[line.speaker]}
											</button>
										) : null;
									})}
								</div>
							</div>
						))}
					</div>
				</section>
			)}
			{analysis.actions.length > 0 && (
				<section className="card" id={ACTIONS_ANCHOR}>
					<div className="card-h">
						應優先調閱 <small>依時效排序</small>
					</div>
					<div className="card-b">
						<ol className="pull">
							{analysis.actions.map(action => (
								<li key={action.id} className={action.urgent ? "urgent" : ""}>
									<span>
										{action.text}
										<small>{action.reason}</small>
									</span>
									<span className="due">
										{action.urgent && (
											<>
												<AlertTriangle size={11} /> 優先
											</>
										)}
									</span>
								</li>
							))}
						</ol>
					</div>
				</section>
			)}
			{popover}
		</>
	);
}
