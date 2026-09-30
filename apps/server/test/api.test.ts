import { GenerationEventSchema, HealthResponseSchema, ModelsResponseSchema, WorkspaceSchema } from "@innoverse/shared";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { createTestApp, multipart, parseEvents, WORKSPACE_ID } from "./helpers/test-app";

const audio = { data: Buffer.from("fake-webm-bytes"), type: "audio/webm;codecs=opus" };
const slideReply = () => JSON.stringify({ html: '<div class="w-full h-full flex gap-8"><div class="text-6xl">🌅 早餐後 💊 1 顆</div><script>x()</script></div>', warnings: [] });
const docReply = (input: string) => JSON.stringify({ markdown: input.includes("<current_artifact>") ? "# 更新後\n" : "# 用藥說明\n\n- 一天三次\n", warnings: [] });

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup) await fn();
	cleanup = [];
});

async function setup(options: Parameters<typeof createTestApp>[0] = {}) {
	const ctx = await createTestApp(options);
	cleanup.push(ctx.close);
	return ctx;
}

function generateFields(overrides: Record<string, string> = {}) {
	return { workspaceId: WORKSPACE_ID, mode: "presentation", continue: "false", model: "", reasoningEffort: "", artifactRevision: "0", ...overrides };
}

describe("GET /api/health", () => {
	it("reports component health", async () => {
		const { app } = await setup();
		const response = await app.inject({ method: "GET", url: "/api/health" });
		expect(response.statusCode).toBe(200);
		const body = HealthResponseSchema.parse(response.json());
		expect(body).toMatchObject({ status: "ok", database: { ok: true }, codex: { state: "ready", authenticated: true }, asr: { modelLoaded: true } });
	});

	it("sets security headers", async () => {
		const { app } = await setup();
		const response = await app.inject({ method: "GET", url: "/api/health" });
		expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
		expect(response.headers["x-content-type-options"]).toBe("nosniff");
	});
});

describe("GET /api/models", () => {
	it("returns the sanitized catalog with a default model", async () => {
		const { app } = await setup();
		const response = await app.inject({ method: "GET", url: "/api/models" });
		const body = ModelsResponseSchema.parse(response.json());
		expect(body.defaultModel).toBe("gpt-fast");
		expect(body.models.map(model => model.id)).toEqual(["gpt-fast", "gpt-deep"]);
		expect(JSON.stringify(body)).not.toContain("gpt-secret");
	});

	it("requires Codex authentication", async () => {
		const { app } = await setup({ authenticated: false });
		const response = await app.inject({ method: "GET", url: "/api/models" });
		expect(response.statusCode).toBe(401);
		expect(response.json()).toMatchObject({ error: { code: "CODEX_UNAUTHENTICATED", message: "AI 服務需要重新登入。" } });
	});
});

describe("workspace API", () => {
	it("validates the workspace id", async () => {
		const { app } = await setup();
		const response = await app.inject({ method: "GET", url: "/api/workspaces/not-a-uuid" });
		expect(response.statusCode).toBe(400);
		expect(response.json().error.code).toBe("BAD_REQUEST");
	});

	it("returns an empty workspace for a new id", async () => {
		const { app } = await setup();
		const response = await app.inject({ method: "GET", url: `/api/workspaces/${WORKSPACE_ID}` });
		expect(WorkspaceSchema.parse(response.json())).toEqual({ id: WORKSPACE_ID, artifacts: { presentation: null, document: null }, hotwords: [] });
	});

	it("rejects invalid artifact updates", async () => {
		const { app } = await setup();
		for (const payload of [{ content: "x" }, { content: 3, baseRevision: 0 }, { content: "x", baseRevision: -1 }]) {
			const response = await app.inject({ method: "PUT", url: `/api/workspaces/${WORKSPACE_ID}/artifacts/document`, payload });
			expect(response.statusCode).toBe(400);
		}
		const badMode = await app.inject({ method: "PUT", url: `/api/workspaces/${WORKSPACE_ID}/artifacts/chat`, payload: { content: "x", baseRevision: 0 } });
		expect(badMode.statusCode).toBe(400);
	});

	it("rejects artifact updates with a stale revision", async () => {
		const { app } = await setup();
		const url = `/api/workspaces/${WORKSPACE_ID}/artifacts/document`;
		const first = await app.inject({ method: "PUT", url, payload: { content: "# v1", baseRevision: 0 } });
		expect(first.json().artifact.revision).toBe(1);
		const second = await app.inject({ method: "PUT", url, payload: { content: "# v2", baseRevision: 1 } });
		expect(second.json().artifact.revision).toBe(2);
		const stale = await app.inject({ method: "PUT", url, payload: { content: "# old tab", baseRevision: 1 } });
		expect(stale.statusCode).toBe(409);
		expect(stale.json()).toMatchObject({ error: { code: "STALE_REVISION", message: "內容已在其他地方更新，請再試一次。" }, current: { revision: 2, content: "# v2" } });
	});

	it("sanitizes manual presentation updates", async () => {
		const { app } = await setup();
		const response = await app.inject({
			method: "PUT",
			url: `/api/workspaces/${WORKSPACE_ID}/artifacts/presentation`,
			payload: { content: '<div onclick="x"><p style="a">hi</p><img src=x></div>', baseRevision: 0 }
		});
		expect(response.json().artifact.content).toBe('<div class="w-full h-full"><p>hi</p></div>');
	});

	it("stores normalized hotwords", async () => {
		const { app } = await setup();
		const response = await app.inject({ method: "PUT", url: `/api/workspaces/${WORKSPACE_ID}/hotwords`, payload: { hotwords: [" 克拉黴素", "克拉黴素", "Metformin"] } });
		expect(response.json()).toEqual({ hotwords: ["克拉黴素", "Metformin"] });
	});
});

describe("POST /api/generate", () => {
	it("rejects invalid metadata", async () => {
		const { app, asr } = await setup();
		for (const fields of [generateFields({ workspaceId: "nope" }), generateFields({ mode: "chat" }), generateFields({ continue: "maybe" }), generateFields({ artifactRevision: "x" })]) {
			const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(fields, audio) });
			expect(response.statusCode).toBe(400);
			expect(response.json().error.code).toBe("BAD_REQUEST");
		}
		expect(asr.calls).toHaveLength(0);
	});

	it("rejects invalid model and reasoning effort before any ASR work", async () => {
		const { app, asr } = await setup();
		const badModel = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ model: "gpt-unknown" }), audio) });
		expect(badModel.json().error.code).toBe("INVALID_MODEL");
		const badEffort = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ model: "gpt-deep", reasoningEffort: "none" }), audio) });
		expect(badEffort.json().error.code).toBe("INVALID_REASONING_EFFORT");
		expect(asr.calls).toHaveLength(0);
	});

	it("rejects missing, empty and unsupported audio", async () => {
		const { app } = await setup();
		expect((await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), null) })).json().error.code).toBe("EMPTY_RECORDING");
		expect((await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), { data: Buffer.alloc(0), type: "audio/webm" }) })).json().error.code).toBe("EMPTY_RECORDING");
		expect((await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), { data: Buffer.from("x"), type: "text/html" }) })).json().error.code).toBe("UNSUPPORTED_AUDIO");
	});

	it("rejects uploads over the size limit", async () => {
		const { app } = await setup();
		const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), { data: Buffer.alloc(1024 * 1024 + 10), type: "audio/webm" }) });
		expect(response.statusCode).toBe(413);
		expect(response.json().error.code).toBe("UPLOAD_TOO_LARGE");
	});

	it("streams stages and a sanitized, persisted presentation", async () => {
		const { app, asr, db } = await setup({ reply: slideReply, organizationHotwords: ["阿莫西林"] });
		await db.setHotwords(WORKSPACE_ID, ["克拉黴素"]);
		const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), audio) });
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("application/x-ndjson");
		const events = parseEvents(response.body).map(event => GenerationEventSchema.parse(event));
		expect(events.map(event => (event.type === "stage" ? event.stage : event.type))).toEqual(["transcribing", "generating", "result"]);
		const result = events[2];
		if (result?.type !== "result") throw new Error("expected result");
		expect(result.result.artifact).toMatchObject({ mode: "presentation", revision: 1, content: '<div class="w-full h-full flex gap-8"><div class="text-6xl">🌅 早餐後 💊 1 顆</div></div>' });
		expect(db.getArtifact(WORKSPACE_ID, "presentation")?.codexThreadId).toBe("thread-new-1");
		expect(asr.calls[0]).toMatchObject({ mimeType: "audio/webm", hotwords: ["阿莫西林", "克拉黴素"], language: "zh" });
	});

	it("removes temporary audio after the request", async () => {
		const tempRoot = await mkdtemp(path.join(tmpdir(), "innoverse-tmp-check-"));
		const previous = process.env.TMPDIR;
		process.env.TMPDIR = tempRoot;
		try {
			const { app, asr } = await setup({ reply: slideReply });
			await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), audio) });
			asr.fail = new AppError("ASR_UNAVAILABLE");
			await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ artifactRevision: "1" }), audio) });
			await new Promise(resolve => setTimeout(resolve, 20));
			expect((await readdir(tempRoot)).filter(name => name.startsWith("innoverse-upload-"))).toEqual([]);
		} finally {
			// Assigning undefined would store the string "undefined"; unset it instead.
			if (previous === undefined) delete process.env.TMPDIR;
			else process.env.TMPDIR = previous;
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("Continue=false creates a fresh Codex thread and omits the old artifact", async () => {
		const { app, harness } = await setup({ reply: docReply });
		await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ mode: "document" }), audio) });
		await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ mode: "document", artifactRevision: "1" }), audio) });
		expect(harness.turns.map(turn => turn.threadId)).toEqual(["thread-new-1", "thread-new-2"]);
		expect(harness.turns[1]!.input).not.toContain("<current_artifact>");
		expect(harness.methods()).not.toContain("thread/resume");
	});

	it("Continue=true resumes the thread and sends the manually edited artifact", async () => {
		const { app, harness, db } = await setup({ reply: docReply });
		await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ mode: "document" }), audio) });
		const edit = await app.inject({
			method: "PUT",
			url: `/api/workspaces/${WORKSPACE_ID}/artifacts/document`,
			payload: { content: "# 用藥說明\n\n- 一天三次（藥師手動補充：飯後）\n", baseRevision: 1 }
		});
		expect(edit.json().artifact.revision).toBe(2);

		const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ mode: "document", continue: "true", artifactRevision: "2" }), audio) });
		const events = parseEvents(response.body);
		expect(events.at(-1)).toMatchObject({ type: "result", result: { artifact: { revision: 3, content: "# 更新後\n" } } });
		expect(harness.methods()).toContain("thread/resume");
		expect(harness.turns[1]!.threadId).toBe("thread-new-1");
		expect(harness.turns[1]!.input).toContain("藥師手動補充：飯後");
		expect(db.getArtifact(WORKSPACE_ID, "document")?.codexThreadId).toBe("thread-new-1");
	});

	it("rejects a generation based on a stale revision", async () => {
		const { app, asr } = await setup({ reply: docReply });
		await app.inject({ method: "PUT", url: `/api/workspaces/${WORKSPACE_ID}/artifacts/document`, payload: { content: "# v1", baseRevision: 0 } });
		const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ mode: "document", continue: "true", artifactRevision: "0" }), audio) });
		expect(response.statusCode).toBe(409);
		expect(response.json().error.code).toBe("STALE_REVISION");
		expect(asr.calls).toHaveLength(0);
	});

	it("never lets an older generation overwrite a newer manual edit", async () => {
		const ctx = await setup({ reply: docReply });
		// Simulate a manual edit landing while the AI is generating.
		const original = ctx.asr.transcribe.bind(ctx.asr);
		ctx.asr.transcribe = async input => {
			const result = await original(input);
			ctx.db.saveArtifact({ workspaceId: WORKSPACE_ID, mode: "document", content: "# 手動編輯", warnings: [], baseRevision: 0 });
			return result;
		};
		const response = await ctx.app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ mode: "document" }), audio) });
		expect(parseEvents(response.body).at(-1)).toMatchObject({ type: "error", error: { code: "STALE_REVISION" } });
		expect(ctx.db.getArtifact(WORKSPACE_ID, "document")?.content).toBe("# 手動編輯");
	});

	it("reports no speech and preserves the existing artifact on failure", async () => {
		const { app, asr, db } = await setup({ reply: docReply });
		await app.inject({ method: "PUT", url: `/api/workspaces/${WORKSPACE_ID}/artifacts/document`, payload: { content: "# keep me", baseRevision: 0 } });
		asr.text = "   ";
		const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields({ mode: "document", artifactRevision: "1" }), audio) });
		expect(parseEvents(response.body).at(-1)).toMatchObject({ type: "error", error: { code: "NO_SPEECH", message: "沒有辨識到語音，請再試一次。" } });
		expect(db.getArtifact(WORKSPACE_ID, "document")?.content).toBe("# keep me");
	});

	it("reports invalid AI output without touching the artifact", async () => {
		const { app, db } = await setup({ reply: () => "definitely not json" });
		const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), audio) });
		expect(parseEvents(response.body).at(-1)).toMatchObject({ type: "error", error: { code: "INVALID_OUTPUT", message: "產生內容失敗，原本的內容已保留。" } });
		expect(db.getArtifact(WORKSPACE_ID, "presentation")).toBeNull();
	});

	it("returns 503 before streaming when ASR is unavailable", async () => {
		const { app, asr } = await setup({ reply: slideReply });
		asr.healthy = false;
		const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), audio) });
		expect(response.statusCode).toBe(503);
		expect(response.headers["content-type"]).toContain("application/json");
		expect(response.json()).toMatchObject({ error: { code: "ASR_UNAVAILABLE", message: "語音辨識服務目前無法使用。" } });
		expect(asr.calls).toHaveLength(0);
	});

	it("requires Codex authentication", async () => {
		const { app } = await setup({ authenticated: false });
		const response = await app.inject({ method: "POST", url: "/api/generate", ...multipart(generateFields(), audio) });
		expect(response.statusCode).toBe(401);
	});
});

describe("SPA fallback", () => {
	it("serves index.html for app routes but keeps /api 404s as JSON", async () => {
		const webDir = await mkdtemp(path.join(tmpdir(), "innoverse-web-"));
		await writeFile(path.join(webDir, "index.html"), "<!doctype html><title>app</title>");
		cleanup.push(() => rm(webDir, { recursive: true, force: true }));
		const { app } = await setup({ webDistDir: webDir });
		const page = await app.inject({ method: "GET", url: "/some/client/route" });
		expect(page.statusCode).toBe(200);
		expect(page.body).toContain("<title>app</title>");
		const api = await app.inject({ method: "GET", url: "/api/does-not-exist" });
		expect(api.statusCode).toBe(404);
		expect(api.json().error.code).toBe("NOT_FOUND");
	});
});
