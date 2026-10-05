import { MARKUP_LABELS, parseMarkup } from "@innoverse/shared";

/** Same rendering for a contentEditable host, built with DOM APIs (text only, no HTML parsing). */
export function renderMarkupInto(element: HTMLElement, text: string): void {
	const nodes = parseMarkup(text).map(part => {
		if (!part.kind) return document.createTextNode(part.text);
		const span = document.createElement("span");
		span.className = `kw kw-${part.kind}`;
		span.title = MARKUP_LABELS[part.kind];
		span.textContent = part.text;
		return span;
	});
	element.replaceChildren(...nodes);
}
