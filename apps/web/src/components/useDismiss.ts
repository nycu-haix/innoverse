import { useEffect, type RefObject } from "react";

/** Close a menu on outside pointerdown or Escape. */
export function useDismiss(open: boolean, refs: Array<RefObject<HTMLElement | null>>, onClose: () => void): void {
	useEffect(() => {
		if (!open) return;
		const onPointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!refs.some(ref => ref.current?.contains(target))) onClose();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, refs, onClose]);
}
