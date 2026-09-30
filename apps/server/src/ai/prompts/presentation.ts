import { SLIDE_ALLOWED_CLASSES, SLIDE_ALLOWED_TAGS, SLIDE_HEIGHT, SLIDE_WIDTH } from "@innoverse/shared";

/** Rules for presentation mode: exactly one 16:9 slide of restricted HTML. */
export const PRESENTATION_INSTRUCTIONS = `
# Artifact: one presentation slide

Create exactly ONE 16:9 communication slide (logical size ${SLIDE_WIDTH}×${SLIDE_HEIGHT} px) that a person can understand at a glance, possibly from several meters away.

## Content

- Prioritize immediate comprehension over completeness of wording.
- Use short phrases, not sentences or paragraphs. Large text. Strong hierarchy.
- Use emoji as visual anchors (for example 🌅 🌞 🌙 💊 📅 🚫 ⚠️ ✅ 📞 📍 🕘).
- Group related information visually (cards, rows, columns).
- Chronological instructions must read in chronological order (left→right or top→bottom).
- Only add a title when it adds value.
- No decorative filler, no invented content, no footers, no disclaimers the speaker did not give.

Example source: 「這顆抗生素一天三次、飯後吃，一次一顆，總共吃五天。即使症狀改善也不要自己停藥。」
Semantic result: 🌅 早餐後 💊 1 顆 / 🌞 午餐後 💊 1 顆 / 🌙 晚餐後 💊 1 顆 / 📅 共 5 天 / 🚫 不要自己停藥 — three meal cards in a row, then duration, then a red warning. Never 三次→四次 or 五天→七天.

## Color (Catppuccin Latte semantic classes)

- Neutral/primary information: blue, mauve or teal.
- Positive or confirmed information: green.
- Warnings, prohibitions, danger: red or maroon.
- Caution/notes: yellow or peach.
- Use color sparingly. Prefer soft tinted cards (bg-ctp-*/15) with colored text or borders; use solid accent backgrounds only for small emphasis, with text-ctp-base on them.
- Main text: text-ctp-text. Secondary text: text-ctp-subtext1 or text-ctp-subtext0.
- Legibility beats decoration.

## Typography guidance

The slide is 1600×900. Typical sizes: key items text-5xl to text-7xl, supporting text text-3xl to text-4xl, a single huge number or icon text-8xl/text-9xl. Never smaller than text-2xl. Keep it within the slide; do not overflow.

## HTML rules (strict)

Return the slide as an HTML fragment in the "html" field.
- The root element must be exactly one <div class="w-full h-full ..."> (add layout classes such as flex flex-col items-center justify-center p-16 gap-8).
- Allowed tags only: ${SLIDE_ALLOWED_TAGS.join(", ")}.
- The only allowed attribute is class. No style, id, href, src, data-* or event attributes.
- Allowed classes only (anything else is removed):
${SLIDE_ALLOWED_CLASSES.join(" ")}
- Never use arbitrary Tailwind values (text-[73px], w-[123px], bg-[#abcdef]), variants (hover:, md:), positioning (absolute, fixed), or classes not listed above.
- No Markdown, no code fences, no complete HTML document, no CSS, no <script>, no SVG, no images, no links, no JavaScript, no external resources.
`.trim();
