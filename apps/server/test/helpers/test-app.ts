import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../../src/app";
import type { AsrProvider, TranscriptionInput } from "../../src/asr/asr-client";
import { CaseService } from "../../src/cases/case-service";
import { AppDatabase } from "../../src/db/database";
import { type AppError } from "../../src/errors";
import { createCodexHarness, type HarnessOptions } from "./codex-harness";
import { silentLogger } from "./fake-codex";

export class FakeAsr implements AsrProvider {
	calls: TranscriptionInput[] = [];
	/** Returned in order; the last entry repeats. */
	texts: string[] = ["九月十號下午兩點多，我用網銀轉了五萬。"];
	fail: AppError | null = null;
	healthy = true;

	async transcribe(input: TranscriptionInput) {
		this.calls.push(input);
		if (this.fail) throw this.fail;
		const text = this.texts.length > 1 ? (this.texts.shift() as string) : (this.texts[0] ?? "");
		return { text, audioDurationMs: 4200, model: "fake", provider: "fake", processingMs: 5 };
	}

	async health() {
		return this.healthy ? { reachable: true, modelLoaded: true, model: "fake", device: "cpu" } : { reachable: false, modelLoaded: false, model: null, device: null };
	}
}

export async function createTestApp(options: HarnessOptions & { organizationHotwords?: string[]; webDistDir?: string } = {}) {
	const harness = await createCodexHarness(options);
	const db = new AppDatabase(":memory:");
	const asr = new FakeAsr();
	const dataDir = await mkdtemp(path.join(tmpdir(), "innoverse-test-"));
	const cases = new CaseService({
		db,
		asr,
		codex: harness.service,
		logger: silentLogger,
		audioDir: path.join(dataDir, "audio"),
		asrLanguage: "zh",
		organizationHotwords: options.organizationHotwords ?? [],
		analysisDebounceMs: 0
	});
	const webDir = options.webDistDir ?? dataDir;
	const app = await buildApp(
		{
			config: { MAX_AUDIO_BYTES: 1024 * 1024, MAX_UTTERANCE_SECONDS: 30, WEB_DIST_DIR: webDir, TRUST_PROXY: false, isProduction: false, DEFAULT_MODEL: undefined },
			db,
			asr,
			codex: harness.service,
			cases
		},
		{ logger: false }
	);
	return {
		app,
		db,
		asr,
		cases,
		harness,
		dataDir,
		async close() {
			cases.close();
			await app.close();
			await harness.client.close();
			db.close();
			await rm(dataDir, { recursive: true, force: true });
		}
	};
}

/** Build a multipart body with fields first, then the audio file. */
export function multipart(fields: Record<string, string>, audio: { data: Buffer; type: string } | null) {
	const boundary = "----innoverse-test-boundary";
	const chunks: Buffer[] = [];
	for (const [name, value] of Object.entries(fields)) {
		chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
	}
	if (audio) {
		chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="utterance.wav"\r\nContent-Type: ${audio.type}\r\n\r\n`));
		chunks.push(audio.data);
		chunks.push(Buffer.from("\r\n"));
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`));
	return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
