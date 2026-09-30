import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors";
import { createCodexHarness } from "./helpers/codex-harness";

const baseTurn = { model: "gpt-fast", reasoningEffort: "none", developerInstructions: "rules", input: "hello", outputSchema: { type: "object" } };

describe("CodexService", () => {
	it("lists visible models and hides hidden ones", async () => {
		const { service, client } = await createCodexHarness();
		const models = await service.listModels();
		expect(models.map(model => model.id)).toEqual(["gpt-fast", "gpt-deep"]);
		expect(models[0]).toEqual({ id: "gpt-fast", displayName: "GPT Fast", description: "", supportedReasoningEfforts: ["none", "low"], defaultReasoningEffort: "low", isDefault: true });
		await client.close();
	});

	it("reports authentication without exposing tokens", async () => {
		const { service, client } = await createCodexHarness();
		const status = await service.getAuthStatus();
		expect(status).toEqual({ codexAvailable: true, authenticated: true, account: { type: "chatgpt", email: "user@example.com", planType: "plus" }, pendingLogin: null, loginError: null });
		await client.close();
	});

	it("starts a fresh thread when no thread id is given", async () => {
		const { service, client, methods, turns } = await createCodexHarness({ reply: () => '{"ok":true}' });
		const result = await service.runTurn({ ...baseTurn, threadId: null });
		expect(result).toEqual({ threadId: "thread-new-1", resumed: false, text: '{"ok":true}' });
		expect(methods()).toContain("thread/start");
		expect(methods()).not.toContain("thread/resume");
		expect(turns[0]!.params).toMatchObject({ effort: "none", sandboxPolicy: { type: "readOnly", networkAccess: false }, approvalPolicy: "never", outputSchema: { type: "object" } });
		await client.close();
	});

	it("resumes an existing thread", async () => {
		const { service, client, methods } = await createCodexHarness({ reply: () => "{}" });
		const result = await service.runTurn({ ...baseTurn, threadId: "thread-old" });
		expect(result.threadId).toBe("thread-old");
		expect(result.resumed).toBe(true);
		expect(methods()).toContain("thread/resume");
		expect(methods()).not.toContain("thread/start");
		await client.close();
	});

	it("falls back to a fresh thread when resume fails", async () => {
		const { service, client, methods } = await createCodexHarness({ reply: () => "{}", resumeFails: true });
		const result = await service.runTurn({ ...baseTurn, threadId: "thread-gone" });
		expect(result).toMatchObject({ threadId: "thread-new-1", resumed: false });
		expect(methods()).toEqual(expect.arrayContaining(["thread/resume", "thread/start", "turn/start"]));
		await client.close();
	});

	it("maps failed turns to user-facing error codes", async () => {
		const limited = await createCodexHarness({ turnStatus: "failed", turnError: { message: "slow down", codexErrorInfo: "usageLimitExceeded" } });
		await expect(limited.service.runTurn({ ...baseTurn, threadId: null })).rejects.toMatchObject({ code: "CODEX_RATE_LIMITED" });
		await limited.client.close();

		const unauthorized = await createCodexHarness({ turnStatus: "failed", turnError: { message: "401", codexErrorInfo: { responseStreamConnectionFailed: { httpStatusCode: 401 } } } });
		await expect(unauthorized.service.runTurn({ ...baseTurn, threadId: null })).rejects.toMatchObject({ code: "GENERATION_FAILED" });
		await unauthorized.client.close();
	});

	it("refuses to run turns when not authenticated", async () => {
		const { service, client } = await createCodexHarness({ authenticated: false });
		await expect(service.runTurn({ ...baseTurn, threadId: null })).rejects.toBeInstanceOf(AppError);
		await expect(service.runTurn({ ...baseTurn, threadId: null })).rejects.toMatchObject({ code: "CODEX_UNAUTHENTICATED" });
		await client.close();
	});

	it("fails the turn clearly when the app-server crashes mid-turn", async () => {
		const { service, client, children, turns } = await createCodexHarness({ hangTurns: true });
		const turn = service.runTurn({ ...baseTurn, threadId: "thread-old" });
		await vi.waitFor(() => expect(turns).toHaveLength(1));
		children[0]!.crash(1);
		await expect(turn).rejects.toMatchObject({ code: "CODEX_UNAVAILABLE" });
		await client.close();
	});
});
