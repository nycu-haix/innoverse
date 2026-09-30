export type Box = { x: number; y: number; width: number; height: number };

/** Upper bound for enlarging sparse generated content. */
export const MAX_CONTENT_SCALE = 1.4;

/** Uniform canvas scale that fits the logical slide into the available area. */
export function computeCanvasScale(available: { width: number; height: number }, slide: { width: number; height: number }): number {
	if (available.width <= 0 || available.height <= 0) return 0;
	return Math.min(available.width / slide.width, available.height / slide.height);
}

/**
 * Content auto-fit inside the slide (logical px). Enlarges sparse content up to
 * MAX_CONTENT_SCALE and shrinks overflowing content, then centers its bounding box.
 * Returns the identity transform when no adjustment is worthwhile.
 */
export function computeContentFit(bounds: Box | null, slide: { width: number; height: number }, margin = 0.06): { scale: number; translateX: number; translateY: number } {
	const identity = { scale: 1, translateX: 0, translateY: 0 };
	if (!bounds || bounds.width <= 0 || bounds.height <= 0) return identity;
	const availableWidth = slide.width * (1 - margin * 2);
	const availableHeight = slide.height * (1 - margin * 2);
	const overflowing = bounds.x < -1 || bounds.y < -1 || bounds.x + bounds.width > slide.width + 1 || bounds.y + bounds.height > slide.height + 1;
	let scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height, MAX_CONTENT_SCALE);
	if (!overflowing) scale = Math.max(scale, 1);
	// Ignore tiny adjustments to avoid visual jitter.
	if (!overflowing && scale < 1.05) return identity;
	const translateX = (slide.width - bounds.width * scale) / 2 - bounds.x * scale;
	const translateY = (slide.height - bounds.height * scale) / 2 - bounds.y * scale;
	return { scale, translateX, translateY };
}
