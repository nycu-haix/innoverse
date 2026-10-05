export type DiffPart = { op: "=" | "-" | "+"; text: string };

/** Character-level LCS diff; inputs are short (one fact), so O(n·m) is fine. */
export function diffChars(before: string, after: string): DiffPart[] {
	const a = [...before];
	const b = [...after];
	const n = a.length;
	const m = b.length;
	const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
		}
	}
	const parts: DiffPart[] = [];
	const push = (op: DiffPart["op"], text: string) => {
		const last = parts.at(-1);
		if (last && last.op === op) last.text += text;
		else parts.push({ op, text });
	};
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			push("=", a[i++]!);
			j++;
		} else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
			push("-", a[i++]!);
		} else {
			push("+", b[j++]!);
		}
	}
	while (i < n) push("-", a[i++]!);
	while (j < m) push("+", b[j++]!);
	return parts;
}
