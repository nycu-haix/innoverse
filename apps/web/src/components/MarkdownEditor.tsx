import { defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { useEffect, useRef } from "react";

type Props = {
	value: string;
	readOnly: boolean;
	onChange: (markdown: string) => void;
	ariaLabel: string;
};

/**
 * Milkdown (ProseMirror) Markdown editor. Markdown is the canonical format.
 * External value changes (generation results, conflict reloads) replace the document
 * without echoing back as a user edit.
 */
export function MarkdownEditor({ value, readOnly, onChange, ariaLabel }: Props) {
	const hostRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<Editor | null>(null);
	/** Markdown currently shown by the editor (as serialized by Milkdown). */
	const shownRef = useRef<string | null>(null);
	/** Last value received from props, to detect external changes. */
	const valueRef = useRef(value);
	const readOnlyRef = useRef(readOnly);
	const onChangeRef = useRef(onChange);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		let disposed = false;
		const editor = Editor.make()
			.config(ctx => {
				ctx.set(rootCtx, host);
				ctx.set(defaultValueCtx, valueRef.current);
				ctx.update(editorViewOptionsCtx, previous => ({
					...previous,
					editable: () => !readOnlyRef.current,
					attributes: { class: "doc-prosemirror", "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true" }
				}));
				ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
					if (markdown === shownRef.current) return;
					shownRef.current = markdown;
					onChangeRef.current(markdown);
				});
			})
			.use(commonmark)
			.use(gfm)
			.use(listener)
			.use(history);

		void editor.create().then(created => {
			if (disposed) {
				void created.destroy();
				return;
			}
			editorRef.current = created;
			// The value may have changed while the editor was being created.
			if (created.action(getMarkdown()) !== valueRef.current) created.action(replaceAll(valueRef.current, true));
			shownRef.current = created.action(getMarkdown());
		});

		return () => {
			disposed = true;
			const current = editorRef.current;
			editorRef.current = null;
			if (current) void current.destroy();
		};
	}, [ariaLabel]);

	// Apply external content changes.
	useEffect(() => {
		valueRef.current = value;
		const editor = editorRef.current;
		if (!editor || value === shownRef.current) return;
		editor.action(replaceAll(value, true));
		shownRef.current = editor.action(getMarkdown());
	}, [value]);

	// Toggle editability without recreating the editor.
	useEffect(() => {
		readOnlyRef.current = readOnly;
		editorRef.current?.action(ctx => ctx.get(editorViewCtx).setProps({}));
	}, [readOnly]);

	return <div ref={hostRef} className="doc-content" />;
}
