import { CaseDetailSchema, CaseListResponseSchema, HealthResponseSchema, ModelsResponseSchema, type AnalysisDelta } from "@innoverse/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { createTestApp, multipart } from "./helpers/test-app";

const wav = { data: Buffer.from("RIFF-fake-wav"), type: "audio/wav" };

function analysisReply(overrides: Partial<AnalysisDelta> = {}): AnalysisDelta {
	return {
		removedBlockIds: [],
		fraudType: "假投資",
		deliveryMethods: ["銀行轉帳"],
		victimName: "林○○",
		speakers: [
			{ lineId: "L1", speaker: "victim", uncertain: false },
			{ lineId: "L99", speaker: "officer", uncertain: false }
		],
		blocks: [
			{
				id: "payment-1",
				kind: "payment",
				title: "交付 #1",
				subtitle: "網路銀行轉帳",
				status: "pending",
				facts: [{ id: "payment-1-transfer", text: "{t|9 月 10 日 14 時許}，網路銀行轉帳 {a|NT$50,000}", sources: ["L1", "L42"], status: "ok", note: null, verifyWith: "轉帳紀錄" }],
				gaps: [
					{
						id: "payee-account",
						field: "收款帳號與戶名",
						level: "must",
						question: "轉進去的帳號是哪一家銀行、帳號多少？",
						reason: "目前只知道轉到王姓帳戶",
						use: "調閱帳戶交易明細、通報警示帳戶",
						basis: "L1 提到轉帳",
						priority: 1
					}
				]
			}
		],
		conflicts: [],
		actions: [{ id: "freeze", text: "通報警示帳戶", urgent: true, reason: "避免款項再被轉出" }],
		...overrides
	};
}

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup) await fn();
	cleanup = [];
});

async function setup(options: Parameters<typeof createTestApp>[0] = {}) {
	const ctx = await createTestApp({ reply: () => JSON.stringify(analysisReply()), ...options });
	cleanup.push(ctx.close);
	return ctx;
}

async function createCase(ctx: Awaited<ReturnType<typeof setup>>) {
	const response = await ctx.app.inject({ method: "POST", url: "/api/cases" });
	expect(response.statusCode).toBe(201);
	return CaseDetailSchema.parse(response.json());
}

async function postUtterance(ctx: Awaited<ReturnType<typeof setup>>, caseId: string, fields: Record<string, string> = {}, audio = wav) {
	const body = multipart({ startedAt: String(Date.UTC(2026, 9, 5, 6, 2, 10)), durationMs: "4200", ...fields }, audio);
	return ctx.app.inject({ method: "POST", url: `/api/cases/${caseId}/utterances`, payload: body.payload, headers: body.headers });
}

async function detail(ctx: Awaited<ReturnType<typeof setup>>, caseId: string) {
	await ctx.cases.settled(caseId);
	const response = await ctx.app.inject({ method: "GET", url: `/api/cases/${caseId}` });
	expect(response.statusCode).toBe(200);
	return CaseDetailSchema.parse(response.json());
}

describe("health and models", () => {
	it("reports component health with security headers", async () => {
		const ctx = await setup();
		const response = await ctx.app.inject({ method: "GET", url: "/api/health" });
		expect(HealthResponseSchema.parse(response.json())).toMatchObject({ status: "ok", codex: { state: "ready", authenticated: true } });
		expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
	});

	it("returns the sanitized model catalog", async () => {
		const ctx = await setup();
		const body = ModelsResponseSchema.parse((await ctx.app.inject({ method: "GET", url: "/api/models" })).json());
		expect(body.models.map(model => model.id)).toEqual(["gpt-fast", "gpt-deep"]);
	});
});

describe("cases", () => {
	it("creates and lists cases", async () => {
		const ctx = await setup();
		const created = await createCase(ctx);
		expect(created).toMatchObject({ utterances: [], analysis: null, record: { content: "", revision: 0 }, analysisStatus: { state: "idle" } });
		const list = CaseListResponseSchema.parse((await ctx.app.inject({ method: "GET", url: "/api/cases" })).json());
		expect(list.cases.map(item => item.id)).toEqual([created.id]);
	});

	it("validates ids and returns 404 for unknown cases", async () => {
		const ctx = await setup();
		expect((await ctx.app.inject({ method: "GET", url: "/api/cases/nope" })).statusCode).toBe(400);
		expect((await ctx.app.inject({ method: "GET", url: "/api/cases/3f2c1b8e-7a4d-4e6f-9b1a-2c3d4e5f6a7b" })).statusCode).toBe(404);
	});
});

describe("utterances and analysis", () => {
	it("transcribes, keeps audio, then analyzes the case", async () => {
		const ctx = await setup({ organizationHotwords: ["竹北"] });
		await ctx.app.inject({ method: "PUT", url: "/api/settings", payload: { model: null, reasoningEffort: null, hotwords: ["鼎盛國際"] } });
		const created = await createCase(ctx);

		const response = await postUtterance(ctx, created.id);
		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({ id: "L1", seq: 1, text: "九月十號下午兩點多，我用網銀轉了五萬。", speakerSource: "heuristic", speakerUncertain: true, hasAudio: true });
		expect(ctx.asr.calls[0]?.hotwords).toEqual(["竹北", "鼎盛國際"]);

		const audio = await ctx.app.inject({ method: "GET", url: `/api/cases/${created.id}/utterances/L1/audio` });
		expect(audio.statusCode).toBe(200);
		expect(audio.headers["content-type"]).toBe("audio/wav");
		expect(audio.rawPayload.toString()).toBe("RIFF-fake-wav");

		const after = await detail(ctx, created.id);
		expect(after.startedAt).toBe("2026-10-05T06:02:10.000Z");
		expect(after).toMatchObject({ fraudType: "假投資", victimName: "林○○", analyzedThrough: 1, analysisStatus: { state: "idle", error: null } });
		expect(after.utterances[0]).toMatchObject({ speaker: "victim", speakerSource: "ai", speakerUncertain: false });
		// Unknown source lines are dropped; officer state defaults are applied.
		const fact = after.analysis?.blocks[0]?.facts[0];
		expect(fact).toMatchObject({ sources: ["L1"], original: null });
		expect(after.analysis?.blocks[0]?.gaps[0]).toMatchObject({ id: "payee-account", state: "open" });

		const turn = ctx.harness.turns.at(-1);
		expect(turn?.input).toContain("[L1 14:02:10 被害人?]");
		expect(turn?.input).toContain("115 年 10 月 5 日 14 時 02 分");
		expect(turn?.threadId).toMatch(/^thread-new-/);
		expect(turn?.params.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
	});

	it("ignores utterances without speech", async () => {
		const ctx = await setup();
		const created = await createCase(ctx);
		ctx.asr.texts = ["   "];
		const response = await postUtterance(ctx, created.id);
		expect(response.statusCode).toBe(422);
		expect(response.json().error.code).toBe("NO_SPEECH");
		expect((await detail(ctx, created.id)).utterances).toEqual([]);
	});

	it("rejects unsupported audio and bad fields", async () => {
		const ctx = await setup();
		const created = await createCase(ctx);
		expect((await postUtterance(ctx, created.id, {}, { data: Buffer.from("x"), type: "text/plain" })).statusCode).toBe(415);
		expect((await postUtterance(ctx, created.id, { startedAt: "soon" })).statusCode).toBe(400);
		expect(ctx.asr.calls).toHaveLength(0);
	});

	it("maps ASR failures to an error response", async () => {
		const ctx = await setup();
		const created = await createCase(ctx);
		ctx.asr.fail = new AppError("ASR_UNAVAILABLE");
		const response = await postUtterance(ctx, created.id);
		expect(response.statusCode).toBe(503);
		expect(response.json().error.code).toBe("ASR_UNAVAILABLE");
	});

	it("keeps manual speaker corrections across analysis passes", async () => {
		const ctx = await setup();
		const created = await createCase(ctx);
		await postUtterance(ctx, created.id);
		await detail(ctx, created.id);

		const put = await ctx.app.inject({ method: "PUT", url: `/api/cases/${created.id}/utterances/L1/speaker`, payload: { speaker: "officer" } });
		expect(put.statusCode).toBe(204);
		const after = await detail(ctx, created.id);
		expect(after.utterances[0]).toMatchObject({ speaker: "officer", speakerSource: "manual" });
		expect(ctx.harness.turns.at(-1)?.input).toContain("[L1 14:02:10 員警!]");
	});

	it("reports analysis failures without losing the previous analysis", async () => {
		let reply = JSON.stringify(analysisReply());
		const ctx = await setup({ reply: () => reply });
		const created = await createCase(ctx);
		await postUtterance(ctx, created.id);
		await detail(ctx, created.id);

		reply = "not json";
		await postUtterance(ctx, created.id);
		const after = await detail(ctx, created.id);
		expect(after.analysisStatus).toMatchObject({ state: "error", error: { code: "INVALID_OUTPUT" } });
		expect(after.analysis?.blocks).toHaveLength(1);
		expect(after.analyzedThrough).toBe(1);
	});

	it("carries over omitted blocks, orders them by the case timeline and removes only listed ids", async () => {
		let reply = analysisReply();
		const ctx = await setup({ reply: () => JSON.stringify(reply) });
		const created = await createCase(ctx);
		await postUtterance(ctx, created.id);
		await detail(ctx, created.id);

		const discovery = { id: "discovery", kind: "discovery" as const, title: "發現受騙", subtitle: null, status: "ok" as const, facts: [], gaps: [] };
		const contact = { ...discovery, id: "contact", kind: "contact" as const, title: "初次接觸" };
		reply = analysisReply({ blocks: [discovery, contact] });
		await postUtterance(ctx, created.id);
		let after = await detail(ctx, created.id);
		expect(after.analysis?.blocks.map(block => block.id)).toEqual(["contact", "payment-1", "discovery"]);
		expect(after.analysis?.blocks[1]?.facts).toHaveLength(1);

		reply = analysisReply({ blocks: [], removedBlockIds: ["payment-1"] });
		await ctx.app.inject({ method: "POST", url: `/api/cases/${created.id}/analyze` });
		after = await detail(ctx, created.id);
		expect(after.analysis?.blocks.map(block => block.id)).toEqual(["contact", "discovery"]);
	});

	it("bumps the version on every change", async () => {
		const ctx = await setup();
		const created = await createCase(ctx);
		const version = async () => (await ctx.app.inject({ method: "GET", url: `/api/cases/${created.id}/version` })).json().version as number;
		const before = await version();
		await postUtterance(ctx, created.id);
		await ctx.cases.settled(created.id);
		expect(await version()).toBeGreaterThan(before);
	});
});

describe("officer decisions", () => {
	it("edits a fact, keeps the AI original and sends the edit back to the model", async () => {
		const ctx = await setup();
		const created = await createCase(ctx);
		await postUtterance(ctx, created.id);
		await detail(ctx, created.id);

		const url = `/api/cases/${created.id}/facts/payment-1-transfer`;
		expect((await ctx.app.inject({ method: "PUT", url, payload: { text: "9 月 10 日 14 時許，網路銀行轉帳 NT$60,000" } })).statusCode).toBe(204);
		let fact = (await detail(ctx, created.id)).analysis?.blocks[0]?.facts[0];
		expect(fact).toMatchObject({ text: "9 月 10 日 14 時許，網路銀行轉帳 NT$60,000", original: "{t|9 月 10 日 14 時許}，網路銀行轉帳 {a|NT$50,000}" });

		await ctx.app.inject({ method: "POST", url: `/api/cases/${created.id}/analyze` });
		await ctx.cases.settled(created.id);
		expect(ctx.harness.turns.at(-1)?.input).toContain('"editedByOfficer":true');

		expect((await ctx.app.inject({ method: "PUT", url, payload: { text: null } })).statusCode).toBe(204);
		fact = (await detail(ctx, created.id)).analysis?.blocks[0]?.facts[0];
		expect(fact).toMatchObject({ text: "{t|9 月 10 日 14 時許}，網路銀行轉帳 {a|NT$50,000}", original: null });
	});

	it("keeps an edited fact when a later pass drops it", async () => {
		let reply = analysisReply();
		const ctx = await setup({ reply: () => JSON.stringify(reply) });
		const created = await createCase(ctx);
		await postUtterance(ctx, created.id);
		await detail(ctx, created.id);
		await ctx.app.inject({ method: "PUT", url: `/api/cases/${created.id}/facts/payment-1-transfer`, payload: { text: "改過的內容" } });

		reply = analysisReply();
		reply.blocks[0]!.facts = [];
		await ctx.app.inject({ method: "POST", url: `/api/cases/${created.id}/analyze` });
		const after = await detail(ctx, created.id);
		expect(after.analysis?.blocks[0]?.facts).toEqual([expect.objectContaining({ id: "payment-1-transfer", text: "改過的內容", sources: ["L1"] })]);
	});

	it("records gap decisions and rejects unknown ids", async () => {
		const ctx = await setup();
		const created = await createCase(ctx);
		await postUtterance(ctx, created.id);
		await detail(ctx, created.id);

		const url = `/api/cases/${created.id}/gaps/payee-account`;
		expect((await ctx.app.inject({ method: "PUT", url, payload: { state: "asked" } })).statusCode).toBe(204);
		expect((await detail(ctx, created.id)).analysis?.blocks[0]?.gaps[0]?.state).toBe("asked");
		expect((await ctx.app.inject({ method: "PUT", url, payload: { state: "open" } })).statusCode).toBe(204);
		expect((await detail(ctx, created.id)).analysis?.blocks[0]?.gaps[0]?.state).toBe("open");
		expect((await ctx.app.inject({ method: "PUT", url: `/api/cases/${created.id}/gaps/nope`, payload: { state: "asked" } })).statusCode).toBe(404);
		expect((await ctx.app.inject({ method: "PUT", url, payload: { state: "done" } })).statusCode).toBe(400);
	});
});

describe("record (筆錄)", () => {
	it("drafts the record and saves edits with optimistic concurrency", async () => {
		const ctx = await setup({
			reply: input =>
				input.includes("Draft the 調查筆錄") ? JSON.stringify({ markdown: "```markdown\n# 調查筆錄\n\n**問：** 何時轉帳？\n\n**答：** 九月十號。\n```" }) : JSON.stringify(analysisReply())
		});
		const created = await createCase(ctx);

		const empty = await ctx.app.inject({ method: "POST", url: `/api/cases/${created.id}/record/generate` });
		expect(empty.statusCode).toBe(422);

		await postUtterance(ctx, created.id);
		await detail(ctx, created.id);
		const generated = await ctx.app.inject({ method: "POST", url: `/api/cases/${created.id}/record/generate` });
		expect(generated.statusCode).toBe(200);
		expect(generated.json().record).toMatchObject({ content: "# 調查筆錄\n\n**問：** 何時轉帳？\n\n**答：** 九月十號。\n", revision: 1 });

		const url = `/api/cases/${created.id}/record`;
		const saved = await ctx.app.inject({ method: "PUT", url, payload: { content: "# 調查筆錄\n\n修改\n", baseRevision: 1 } });
		expect(saved.json().record).toMatchObject({ revision: 2 });
		const stale = await ctx.app.inject({ method: "PUT", url, payload: { content: "舊的", baseRevision: 1 } });
		expect(stale.statusCode).toBe(409);
		expect(stale.json()).toMatchObject({ error: { code: "STALE_REVISION" }, current: { revision: 2, content: "# 調查筆錄\n\n修改\n" } });
	});
});
