import { MarkdownEditor } from "./MarkdownEditor";

type Props = {
	markdown: string;
	readOnly: boolean;
	onChange: (markdown: string) => void;
};

/** A4-oriented page; content may continue past one physical page. */
export function DocumentPage({ markdown, readOnly, onChange }: Props) {
	const empty = markdown.trim() === "";
	return (
		<div className="doc-scroll h-full w-full overflow-y-auto px-3 pt-4 pb-32 sm:px-8 sm:pt-10">
			<article className="doc-page relative mx-auto rounded-md border border-ctp-crust bg-ctp-base px-[12mm] py-[16mm] shadow-[var(--shadow-page)] sm:px-[20mm] sm:py-[20mm]" aria-busy={readOnly}>
				{empty && (
					<p className="no-print pointer-events-none absolute inset-x-0 top-[40%] text-center text-2xl text-ctp-overlay0" aria-hidden="true">
						按下錄音開始
					</p>
				)}
				<MarkdownEditor value={markdown} readOnly={readOnly} onChange={onChange} ariaLabel="文件內容" />
			</article>
		</div>
	);
}
