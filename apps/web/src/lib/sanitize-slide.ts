import { isAllowedSlideClass, SLIDE_ALLOWED_TAGS, SLIDE_FORBIDDEN_TAGS } from "@innoverse/shared";
import DOMPurify from "dompurify";

let purifier: ReturnType<typeof DOMPurify> | null = null;

function getPurifier() {
	if (purifier) return purifier;
	// A dedicated instance so these hooks never affect other DOMPurify users.
	const instance = DOMPurify(window);
	instance.addHook("uponSanitizeAttribute", (_node, data) => {
		if (data.attrName !== "class") {
			data.keepAttr = false;
			return;
		}
		const kept = data.attrValue.split(/\s+/).filter(token => token && isAllowedSlideClass(token));
		data.attrValue = kept.join(" ");
		if (kept.length === 0) data.keepAttr = false;
	});
	purifier = instance;
	return instance;
}

/**
 * Browser-side defense in depth for AI slide HTML (the server already sanitized it).
 * Mirrors the server policy: allowlisted tags, only `class`, allowlisted classes.
 */
export function sanitizeSlideHtml(html: string): string {
	return getPurifier().sanitize(html, {
		ALLOWED_TAGS: [...SLIDE_ALLOWED_TAGS],
		ALLOWED_ATTR: ["class"],
		FORBID_TAGS: [...SLIDE_FORBIDDEN_TAGS],
		FORBID_ATTR: ["style", "id", "href", "src", "srcset", "action", "formaction", "xlink:href"],
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
		ALLOW_UNKNOWN_PROTOCOLS: false,
		ALLOW_SELF_CLOSE_IN_ATTR: false,
		WHOLE_DOCUMENT: false,
		RETURN_TRUSTED_TYPE: false,
		KEEP_CONTENT: true
	});
}
