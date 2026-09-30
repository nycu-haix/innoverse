/**
 * Policy for AI-generated presentation HTML.
 *
 * This file is the single, auditable source of truth for what generated slides may
 * contain. It is used by the server sanitizer, the browser DOMPurify policy, the
 * presentation prompt, and the Tailwind build (apps/web/src/styles/index.css
 * registers this file with `@source`, so every class below is compiled into the
 * production CSS; apps/web/scripts/check-slide-classes.mjs verifies that after build).
 *
 * Every class MUST be written out literally. Do not build class names dynamically.
 */

export const SLIDE_ALLOWED_TAGS = ["div", "span", "p", "h1", "h2", "h3", "ul", "ol", "li", "strong", "em", "br"] as const;

/** Tags whose entire subtree is dropped rather than unwrapped. */
export const SLIDE_FORBIDDEN_TAGS = [
	"script",
	"style",
	"iframe",
	"frame",
	"frameset",
	"object",
	"embed",
	"form",
	"input",
	"button",
	"textarea",
	"select",
	"option",
	"video",
	"audio",
	"source",
	"track",
	"canvas",
	"svg",
	"math",
	"img",
	"picture",
	"link",
	"meta",
	"base",
	"template",
	"noscript",
	"title",
	"head"
] as const;

export const SLIDE_ALLOWED_CLASSES = [
	// Sizing
	"w-full",
	"h-full",
	"min-w-0",
	"flex-1",
	"shrink-0",
	// Flex / grid
	"flex",
	"flex-col",
	"flex-row",
	"flex-wrap",
	"grid",
	"grid-cols-1",
	"grid-cols-2",
	"grid-cols-3",
	"grid-cols-4",
	"grid-rows-2",
	"grid-rows-3",
	"col-span-2",
	"col-span-3",
	"items-start",
	"items-center",
	"items-end",
	"items-stretch",
	"justify-start",
	"justify-center",
	"justify-end",
	"justify-between",
	"justify-around",
	"gap-2",
	"gap-3",
	"gap-4",
	"gap-6",
	"gap-8",
	"gap-10",
	"gap-12",
	"gap-16",
	// Spacing
	"p-4",
	"p-6",
	"p-8",
	"p-10",
	"p-12",
	"p-16",
	"p-20",
	"p-24",
	"px-4",
	"px-6",
	"px-8",
	"px-12",
	"px-16",
	"py-2",
	"py-4",
	"py-6",
	"py-8",
	"py-12",
	"py-16",
	// Lists
	"list-disc",
	"list-decimal",
	"list-inside",
	// Typography
	"text-left",
	"text-center",
	"text-right",
	"text-xl",
	"text-2xl",
	"text-3xl",
	"text-4xl",
	"text-5xl",
	"text-6xl",
	"text-7xl",
	"text-8xl",
	"text-9xl",
	"font-normal",
	"font-medium",
	"font-semibold",
	"font-bold",
	"leading-none",
	"leading-tight",
	"leading-snug",
	"tracking-tight",
	"whitespace-nowrap",
	// Shape
	"rounded-xl",
	"rounded-2xl",
	"rounded-3xl",
	"rounded-full",
	"border",
	"border-2",
	"border-4",
	"shadow-sm",
	"shadow",
	"shadow-lg",
	"overflow-hidden",
	// Catppuccin Latte backgrounds
	"bg-ctp-base",
	"bg-ctp-mantle",
	"bg-ctp-crust",
	"bg-ctp-surface0",
	"bg-ctp-surface1",
	"bg-ctp-blue",
	"bg-ctp-green",
	"bg-ctp-yellow",
	"bg-ctp-red",
	"bg-ctp-maroon",
	"bg-ctp-mauve",
	"bg-ctp-peach",
	"bg-ctp-teal",
	// Soft tints of the accent colors (for grouped cards on the light base)
	"bg-ctp-blue/15",
	"bg-ctp-green/15",
	"bg-ctp-yellow/15",
	"bg-ctp-red/15",
	"bg-ctp-maroon/15",
	"bg-ctp-mauve/15",
	"bg-ctp-peach/15",
	"bg-ctp-teal/15",
	// Text
	"text-ctp-base",
	"text-ctp-text",
	"text-ctp-subtext0",
	"text-ctp-subtext1",
	"text-ctp-blue",
	"text-ctp-green",
	"text-ctp-yellow",
	"text-ctp-red",
	"text-ctp-maroon",
	"text-ctp-mauve",
	"text-ctp-peach",
	"text-ctp-teal",
	// Borders
	"border-ctp-surface0",
	"border-ctp-surface1",
	"border-ctp-blue",
	"border-ctp-green",
	"border-ctp-red",
	"border-ctp-maroon",
	"border-ctp-mauve",
	"border-ctp-peach",
	"border-ctp-teal",
	"border-ctp-yellow"
] as const;

export type SlideAllowedClass = (typeof SLIDE_ALLOWED_CLASSES)[number];

const allowedClassSet: ReadonlySet<string> = new Set(SLIDE_ALLOWED_CLASSES);
const allowedTagSet: ReadonlySet<string> = new Set(SLIDE_ALLOWED_TAGS);
const forbiddenTagSet: ReadonlySet<string> = new Set(SLIDE_FORBIDDEN_TAGS);

export function isAllowedSlideClass(value: string): boolean {
	return allowedClassSet.has(value);
}

export function isAllowedSlideTag(tag: string): boolean {
	return allowedTagSet.has(tag.toLowerCase());
}

export function isForbiddenSlideTag(tag: string): boolean {
	return forbiddenTagSet.has(tag.toLowerCase());
}

/** Split a class attribute and keep only allowlisted tokens (deduplicated, order kept). */
export function filterSlideClasses(classAttribute: string): { kept: string[]; rejected: string[] } {
	const kept: string[] = [];
	const rejected: string[] = [];
	for (const token of classAttribute.split(/\s+/)) {
		if (!token) continue;
		if (isAllowedSlideClass(token)) {
			if (!kept.includes(token)) kept.push(token);
		} else {
			rejected.push(token);
		}
	}
	return { kept, rejected };
}

/** Logical slide size in CSS pixels; the renderer scales it uniformly. */
export const SLIDE_WIDTH = 1600;
export const SLIDE_HEIGHT = 900;
