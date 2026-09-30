import { describe, expect, it } from "vitest";
import { sanitizeSlideHtml } from "../src/lib/sanitize-slide";

describe("browser slide sanitizer (DOMPurify)", () => {
	it("keeps allowlisted tags and classes", () => {
		const html = '<div class="w-full h-full flex gap-8"><h2 class="text-6xl text-ctp-blue">🌅 早餐後</h2><ul class="list-disc"><li><strong>1</strong> 顆<br></li></ul></div>';
		expect(sanitizeSlideHtml(html)).toBe(html);
	});

	it("removes scripts, event handlers, styles, links and media", () => {
		const output = sanitizeSlideHtml(
			'<div class="w-full h-full" onclick="x()" style="color:red"><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">連結</a><svg><script>1</script></svg><iframe src="//x"></iframe><p id="a">ok</p></div>'
		);
		expect(output).toBe('<div class="w-full h-full">連結<p>ok</p></div>');
	});

	it("drops classes outside the allowlist", () => {
		expect(sanitizeSlideHtml('<p class="text-[73px] fixed text-5xl bg-[#abcdef]">x</p>')).toBe('<p class="text-5xl">x</p>');
		expect(sanitizeSlideHtml('<p class="absolute">x</p>')).toBe("<p>x</p>");
	});
});
