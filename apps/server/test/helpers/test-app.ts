import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../../src/app";
import type { AsrProvider, TranscriptionInput } from "../../src/asr/asr-client";
import { AppDatabase } from "../../src/db/database";
import { type AppError } from "../../src/errors";
import { GenerationService } from "../../src/generation/generation-service";
import { createCodexHarness, type HarnessOptions } from "./codex-harness";
import { silentLogger } from "./fake-codex";

export const WORKSPACE_ID = "3f2c1b8e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";

export class FakeAsr implements AsrProvider {
	calls: TranscriptionInput[] = [];
	text = "這顆抗生素一天三次、飯後吃，一次一顆，總共吃五天。";
	fail: AppError | null = null;
	healthy = true;

	async transcribe(input: TranscriptionInput) {
		this.calls.push(input);
		if (this.fail) throw this.fail;
		return { text: this.text, audioDurationMs: 4200, model: "fake", provider: "fake", processingMs: 5 };
	}

	async health() {
		return this.healthy ? { reachable: true, modelLoaded: true, model: "fake", device: "cpu" } : { reachable: false, modelLoaded: false, model: null, device: null };
	}
}

export async function createTestApp(options: HarnessOptions & { organizationHotwords?: string[]; webDistDir?: string } = {}) {
	const harness = await createCodexHarness(options);
	const db = new AppDatabase(":memory:");
	const asr = new FakeAsr();
	const generation = new GenerationService({
		db,
		asr,
		codex: harness.service,
		logger: silentLogger,
		asrLanguage: "zh",
		organizationHotwords: options.organizationHotwords ?? [],
		persistTranscripts: false,
		logTextPreviews: false
	});
	const webDir = options.webDistDir ?? (await mkdtemp(path.join(tmpdir(), "innoverse-web-")));
	const app = await buildApp(
		{
			config: { MAX_AUDIO_BYTES: 1024 * 1024, MAX_AUDIO_MINUTES: 60, WEB_DIST_DIR: webDir, TRUST_PROXY: false, isProduction: false },
			db,
			asr,
			codex: harness.service,
			generation
		},
		{ logger: false }
	);
	return {
		app,
		db,
		asr,
		harness,
		async close() {
			await app.close();
			await harness.client.close();
			db.close();
			if (!options.webDistDir) await rm(webDir, { recursive: true, force: true });
		}
	};
}

/** Build a multipart body with metadata fields first, then the audio file. */
export function multipart(fields: Record<string, string>, audio: { data: Buffer; type: string } | null) {
	const boundary = "----innoverse-test-boundary";
	const chunks: Buffer[] = [];
	for (const [name, value] of Object.entries(fields)) {
		chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
	}
	if (audio) {
		chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.webm"\r\nContent-Type: ${audio.type}\r\n\r\n`));
		chunks.push(audio.data);
		chunks.push(Buffer.from("\r\n"));
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`));
	return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

export function parseEvents(body: string) {
	return body
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as { type: string; stage?: string; result?: Record<string, unknown>; error?: { code: string; message: string } });
}
