import { filterSlideClasses, isAllowedSlideTag, isForbiddenSlideTag } from "@innoverse/shared";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type ParentNode = DefaultTreeAdapterMap["parentNode"];
type ChildNode = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

export type SlideSanitizeResult = { ok: true; html: string; report: SanitizeReport } | { ok: false; reason: "empty" | "too_large" | "too_deep"; report: SanitizeReport };

export type SanitizeReport = {
	removedElements: string[];
	unwrappedElements: string[];
	removedAttributes: number;
	rejectedClasses: string[];
};

const MAX_INPUT_LENGTH = 100_000;
const MAX_DEPTH = 24;
const MAX_ELEMENTS = 600;

function escapeText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isElement(node: ChildNode): node is Element {
	return "tagName" in node;
}

function isText(node: ChildNode): node is TextNode {
	return node.nodeName === "#text";
}

/**
 * Server-side sanitizer for AI-generated slide HTML.
 *
 * Parses with a spec-compliant HTML parser and rebuilds the markup from scratch:
 * - forbidden elements (script, style, iframe, svg, img, form, ...) are dropped with their content
 * - other unknown elements are unwrapped (their text is kept)
 * - every attribute except `class` is removed
 * - every class token must be in the shared allowlist
 * - comments, doctype and processing instructions are dropped
 *
 * The result always has a single `<div class="w-full h-full ...">` root.
 */
export function sanitizeSlideHtml(input: string): SlideSanitizeResult {
	const report: SanitizeReport = { removedElements: [], unwrappedElements: [], removedAttributes: 0, rejectedClasses: [] };
	if (input.length > MAX_INPUT_LENGTH) return { ok: false, reason: "too_large", report };

	const fragment = parseFragment(input);
	let elementCount = 0;
	let tooDeep = false;

	const serializeChildren = (parent: ParentNode, depth: number): string => {
		let out = "";
		for (const child of parent.childNodes) out += serializeNode(child, depth);
		return out;
	};

	const serializeNode = (node: ChildNode, depth: number): string => {
		if (isText(node)) return escapeText(node.value);
		if (!isElement(node)) return "";
		const tag = node.tagName.toLowerCase();
		if (isForbiddenSlideTag(tag) || node.namespaceURI !== "http://www.w3.org/1999/xhtml") {
			report.removedElements.push(tag);
			return "";
		}
		if (!isAllowedSlideTag(tag)) {
			report.unwrappedElements.push(tag);
			report.removedAttributes += node.attrs.length;
			return serializeChildren(node, depth);
		}
		if (depth > MAX_DEPTH) {
			tooDeep = true;
			return "";
		}
		elementCount++;
		let classes: string[] = [];
		for (const attribute of node.attrs) {
			if (attribute.name === "class") {
				const filtered = filterSlideClasses(attribute.value);
				classes = filtered.kept;
				report.rejectedClasses.push(...filtered.rejected);
			} else {
				report.removedAttributes++;
			}
		}
		const classAttribute = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
		if (tag === "br") return `<br${classAttribute}>`;
		return `<${tag}${classAttribute}>${serializeChildren(node, depth + 1)}</${tag}>`;
	};

	// Unwrap a single outer root so we can normalize it; keep everything else as children.
	const meaningful = fragment.childNodes.filter(node => isElement(node) || (isText(node) && node.value.trim() !== ""));
	const onlyRoot = meaningful.length === 1 && isElement(meaningful[0] as ChildNode) && (meaningful[0] as Element).tagName === "div" ? (meaningful[0] as Element) : null;

	let rootClasses: string[] = [];
	let body: string;
	if (onlyRoot) {
		for (const attribute of onlyRoot.attrs) {
			if (attribute.name === "class") {
				const filtered = filterSlideClasses(attribute.value);
				rootClasses = filtered.kept;
				report.rejectedClasses.push(...filtered.rejected);
			} else {
				report.removedAttributes++;
			}
		}
		body = serializeChildren(onlyRoot, 1);
	} else {
		body = serializeChildren(fragment, 1);
	}

	if (tooDeep) return { ok: false, reason: "too_deep", report };
	if (elementCount > MAX_ELEMENTS) return { ok: false, reason: "too_large", report };

	const textContent = body
		.replace(/<[^>]*>/g, "")
		.replace(/&[a-z]+;/g, " ")
		.trim();
	if (!textContent) return { ok: false, reason: "empty", report };

	const root = ["w-full", "h-full", ...rootClasses.filter(token => token !== "w-full" && token !== "h-full")];
	return { ok: true, html: `<div class="${root.join(" ")}">${body}</div>`, report };
}
