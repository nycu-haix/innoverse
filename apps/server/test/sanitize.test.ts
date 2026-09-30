import { describe, expect, it } from "vitest";
import { sanitizeSlideHtml } from "../src/slide/sanitize";

function html(input: string): string {
	const result = sanitizeSlideHtml(input);
	if (!result.ok) throw new Error(`rejected: ${result.reason}`);
	return result.html;
}

describe("sanitizeSlideHtml", () => {
	it("keeps allowed tags and classes", () => {
		const input =
			'<div class="w-full h-full flex flex-col gap-8 p-16"><h1 class="text-7xl font-bold text-ctp-text">💊 1 顆</h1><ul class="list-disc"><li>早餐後<br>飯後</li></ul><p><strong>共</strong> <em>5 天</em></p></div>';
		expect(html(input)).toBe(input);
	});

	it("removes forbidden tags together with their content", () => {
		const output = html(
			'<div class="w-full h-full"><p>安全</p><script>alert(1)</script><style>p{color:red}</style><iframe src="https://evil"></iframe><svg><circle/></svg><img src=x onerror=alert(1)><form><input value="x"><button>送出</button></form><object data="x"></object></div>'
		);
		expect(output).toBe('<div class="w-full h-full"><p>安全</p></div>');
	});

	it("unwraps unknown but harmless tags and keeps their text", () => {
		expect(html('<div class="w-full h-full"><section><a href="https://example.com">連結文字</a></section></div>')).toBe('<div class="w-full h-full">連結文字</div>');
	});

	it("strips every attribute except class", () => {
		const output = html('<div class="w-full h-full" style="position:fixed" onclick="x()"><p id="a" data-x="1" onmouseover="y()" style="color:red" class="text-4xl">文字</p></div>');
		expect(output).toBe('<div class="w-full h-full"><p class="text-4xl">文字</p></div>');
		expect(output).not.toMatch(/style|onclick|onmouseover|data-x|id=/);
	});

	it("drops classes outside the allowlist, including arbitrary values", () => {
		const result = sanitizeSlideHtml('<div class="w-full h-full absolute"><p class="text-[73px] w-[123px] bg-[#abcdef] text-5xl hover:text-ctp-red fixed">x</p></div>');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.html).toBe('<div class="w-full h-full"><p class="text-5xl">x</p></div>');
		expect(result.report.rejectedClasses).toEqual(["absolute", "text-[73px]", "w-[123px]", "bg-[#abcdef]", "hover:text-ctp-red", "fixed"]);
	});

	it("escapes text so entities cannot become markup", () => {
		expect(html('<div class="w-full h-full"><p>&lt;script&gt;alert(1)&lt;/script&gt; 1 &amp; 2</p></div>')).toBe(
			'<div class="w-full h-full"><p>&lt;script&gt;alert(1)&lt;/script&gt; 1 &amp; 2</p></div>'
		);
	});

	it("normalizes the root to a single w-full h-full div", () => {
		expect(html("<p>只有段落</p><p>第二段</p>")).toBe('<div class="w-full h-full"><p>只有段落</p><p>第二段</p></div>');
		expect(html('<div class="flex">a</div>')).toBe('<div class="w-full h-full flex">a</div>');
	});

	it("drops comments and never passes through javascript: or remote URLs", () => {
		const output = html('<div class="w-full h-full"><!-- note --><p>ok</p><a href="javascript:alert(1)">x</a><link rel="stylesheet" href="https://cdn/x.css"></div>');
		expect(output).toBe('<div class="w-full h-full"><p>ok</p>x</div>');
	});

	it("rejects empty or malformed results", () => {
		expect(sanitizeSlideHtml("")).toMatchObject({ ok: false, reason: "empty" });
		expect(sanitizeSlideHtml('<div class="w-full h-full"><script>only script</script></div>')).toMatchObject({ ok: false, reason: "empty" });
		expect(sanitizeSlideHtml("<div>".repeat(40) + "deep" + "</div>".repeat(40))).toMatchObject({ ok: false, reason: "too_deep" });
		expect(sanitizeSlideHtml("x".repeat(100_001))).toMatchObject({ ok: false, reason: "too_large" });
	});
});
