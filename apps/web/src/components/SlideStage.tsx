import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@innoverse/shared";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { sanitizeSlideHtml } from "../lib/sanitize-slide";
import { computeCanvasScale, computeContentFit, type Box } from "../lib/slide-fit";

const SLIDE = { width: SLIDE_WIDTH, height: SLIDE_HEIGHT };

function hasVisibleBox(style: CSSStyleDeclaration): boolean {
	const transparent = style.backgroundColor === "transparent" || style.backgroundColor === "rgba(0, 0, 0, 0)";
	return !transparent || parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderLeftWidth) > 0;
}

/** Union of text runs and visibly boxed elements, in logical slide pixels. */
function measureContentBounds(root: HTMLElement, canvas: HTMLElement): Box | null {
	const canvasRect = canvas.getBoundingClientRect();
	const scale = canvasRect.width / SLIDE_WIDTH;
	if (!scale) return null;
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	const include = (rect: DOMRect) => {
		if (rect.width === 0 && rect.height === 0) return;
		left = Math.min(left, rect.left);
		top = Math.min(top, rect.top);
		right = Math.max(right, rect.right);
		bottom = Math.max(bottom, rect.bottom);
	};
	const generatedRoot = root.firstElementChild;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (!node.textContent?.trim()) continue;
			range.selectNodeContents(node);
			include(range.getBoundingClientRect());
		} else if (node !== generatedRoot && hasVisibleBox(getComputedStyle(node as Element))) {
			include((node as Element).getBoundingClientRect());
		}
	}
	if (!Number.isFinite(left)) return null;
	return { x: (left - canvasRect.left) / scale, y: (top - canvasRect.top) / scale, width: (right - left) / scale, height: (bottom - top) / scale };
}

/**
 * One 1600×900 slide. Two independent scales:
 * - canvas scale: fits the logical slide into the viewport (ResizeObserver)
 * - content scale: enlarges sparse / shrinks overflowing generated content (measured once per HTML)
 */
export function SlideStage({ html }: { html: string }) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [canvasScale, setCanvasScale] = useState(0);
	const safeHtml = useMemo(() => (html ? sanitizeSlideHtml(html) : ""), [html]);
	const canvasReady = canvasScale > 0;

	useLayoutEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;
		const update = () => {
			const style = getComputedStyle(stage);
			const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
			const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
			setCanvasScale(computeCanvasScale({ width, height }, SLIDE));
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(stage);
		return () => observer.disconnect();
	}, []);

	// Content fit depends only on the HTML (layout inside the canvas is in logical px),
	// so canvas resizes never trigger re-measurement and there is no layout loop.
	useLayoutEffect(() => {
		const content = contentRef.current;
		const canvas = canvasRef.current;
		if (!content || !canvas) return;
		content.style.transform = "";
		if (!safeHtml || !canvasReady) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				const fit = computeContentFit(measureContentBounds(content, canvas), SLIDE);
				content.style.transform = fit.scale === 1 && fit.translateX === 0 && fit.translateY === 0 ? "" : `translate(${fit.translateX}px, ${fit.translateY}px) scale(${fit.scale})`;
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [safeHtml, canvasReady]);

	return (
		<div ref={stageRef} className="slide-stage flex h-full w-full items-center justify-center px-4 pt-4 pb-28 sm:px-8 sm:pt-8">
			<div
				className="slide-frame relative overflow-hidden rounded-lg border border-ctp-crust bg-ctp-base shadow-[var(--shadow-page)]"
				style={{ width: SLIDE_WIDTH * canvasScale, height: SLIDE_HEIGHT * canvasScale, visibility: canvasScale ? "visible" : "hidden" }}
			>
				<div ref={canvasRef} className="slide-canvas bg-ctp-base text-ctp-text" style={{ transform: `scale(${canvasScale})` }}>
					{safeHtml ? (
						<div ref={contentRef} className="slide-content" aria-label="簡報內容" dangerouslySetInnerHTML={{ __html: safeHtml }} />
					) : (
						<div ref={contentRef} className="slide-content flex items-center justify-center">
							<p className="no-print text-4xl text-ctp-overlay0">按下錄音開始</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
