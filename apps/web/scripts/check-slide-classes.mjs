// Verifies that every AI-allowed slide class was compiled into the production CSS.
// Generated slides only exist at runtime, so Tailwind must not rely on discovering them.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = readFileSync(path.resolve(here, "../../../packages/shared/src/slide-policy.ts"), "utf8");
const block = policy.slice(policy.indexOf("SLIDE_ALLOWED_CLASSES = ["), policy.indexOf("] as const;", policy.indexOf("SLIDE_ALLOWED_CLASSES = [")));
const classes = [...block.matchAll(/"([^"]+)"/g)].map(match => match[1]);
if (classes.length < 50) throw new Error(`Could not read the slide class allowlist (found ${classes.length}).`);

const assets = path.resolve(here, "../dist/assets");
const css = readdirSync(assets)
	.filter(file => file.endsWith(".css"))
	.map(file => readFileSync(path.join(assets, file), "utf8"))
	.join("\n");

const escapeSelector = value => value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
const missing = classes.filter(name => !css.includes(`.${escapeSelector(name)}`));
if (missing.length > 0) {
	console.error(`Missing slide classes in production CSS: ${missing.join(", ")}`);
	process.exit(1);
}
console.log(`All ${classes.length} allowlisted slide classes are present in the production CSS.`);
