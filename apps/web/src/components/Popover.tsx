import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Props = {
	anchor: HTMLElement;
	title: ReactNode;
	footer?: ReactNode;
	pinned: boolean;
	onClose: () => void;
	onPointerEnter: () => void;
	onPointerLeave: () => void;
	/** Changes when the anchor may have moved (scroll). */
	layoutKey: number;
	children: ReactNode;
};

/** Floating panel below (or above) an anchor element. */
export function Popover({ anchor, title, footer, pinned, onClose, onPointerEnter, onPointerLeave, layoutKey, children }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const rect = anchor.getBoundingClientRect();
		const height = element.offsetHeight;
		let top = rect.bottom + 6;
		if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
		const left = Math.max(8, Math.min(rect.left, window.innerWidth - element.offsetWidth - 12));
		setPosition({ top, left });
	}, [anchor, layoutKey, children]);

	return (
		<div
			ref={ref}
			className="pop"
			role="dialog"
			style={position ? { top: position.top, left: position.left } : { visibility: "hidden", top: 0, left: 0 }}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
		>
			<div className="pop-h">
				{title}
				{pinned && (
					<button type="button" className="x" onClick={onClose} aria-label="關閉">
						<X size={13} />
					</button>
				)}
			</div>
			<div className="pop-b">{children}</div>
			{footer && <div className="pop-f">{footer}</div>}
		</div>
	);
}
