const EFFORT_LABELS: Record<string, string> = {
	none: "不思考",
	minimal: "極少",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "極高"
};

/** Display label for a Codex reasoning effort; unknown efforts are shown as-is. */
export function effortLabel(effort: string): string {
	return EFFORT_LABELS[effort] ?? effort;
}
