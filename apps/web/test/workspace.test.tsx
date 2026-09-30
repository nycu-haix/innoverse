import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { FakeMediaRecorder, installFakeMedia } from "./fake-media";

const WORKSPACE_ID = "3f2c1b8e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function ndjson(lines: unknown[]) {
	return new Response(lines.map(line => JSON.stringify(line)).join("\n") + "\n", { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

const artifact = (content: string, revision: number) => ({ mode: "presentation", content, revision, warnings: [], updatedAt: "2026-01-01T00:00:00.000Z" });

function mockServer(generate: () => Response) {
	const calls: Array<{ url: string; method: string; body?: BodyInit | null }> = [];
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		calls.push({ url, method, body: init?.body ?? null });
		if (url === "/api/auth/status")
			return json({ codexAvailable: true, authenticated: true, account: { type: "chatgpt", email: "a@example.com", planType: null }, pendingLogin: null, loginError: null });
		if (url === "/api/config") return json({ maxRecordingSeconds: 3600, maxAudioBytes: 1_000_000 });
		if (url === "/api/models")
			return json({
				models: [{ id: "gpt-fast", displayName: "Fast", description: "", supportedReasoningEfforts: ["none", "low"], defaultReasoningEffort: "low", isDefault: true }],
				defaultModel: "gpt-fast"
			});
		if (url.startsWith("/api/workspaces/"))
			return json({ id: WORKSPACE_ID, artifacts: { presentation: artifact('<div class="w-full h-full"><p>舊的內容</p></div>', 1), document: null }, hotwords: [] });
		if (url === "/api/generate") return generate();
		return json({ error: { code: "NOT_FOUND", message: "找不到資料。" } }, 404);
	});
	vi.stubGlobal("fetch", fetchMock);
	return calls;
}

beforeEach(() => {
	localStorage.setItem("innoverse.workspaceId", WORKSPACE_ID);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		}
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function renderReady() {
	render(<App />);
	await screen.findByText("舊的內容");
	await waitFor(() => expect(screen.getByRole("button", { name: "開始錄音" })).toBeEnabled());
}

describe("workspace recording flow", () => {
	it("cancel makes zero network requests and returns to idle", async () => {
		const calls = mockServer(() => ndjson([]));
		const { streams } = installFakeMedia();
		await renderReady();
		const before = calls.length;

		await act(async () => fireEvent.click(screen.getByRole("button", { name: "開始錄音" })));
		expect(await screen.findByRole("button", { name: "取消錄音" })).toBeInTheDocument();
		FakeMediaRecorder.instances[0]!.emitData("private words");

		await act(async () => fireEvent.click(screen.getByRole("button", { name: "取消錄音" })));
		await new Promise(resolve => setTimeout(resolve, 20));

		expect(calls.length).toBe(before);
		expect(calls.some(call => call.url === "/api/generate")).toBe(false);
		expect(streams[0]!.tracks.every(track => track.stopped)).toBe(true);
		expect(screen.getByRole("button", { name: "開始錄音" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "取消錄音" })).not.toBeInTheDocument();
	});

	it("submits once, shows stages, and replaces the artifact only on success", async () => {
		const calls = mockServer(() =>
			ndjson([
				{ type: "stage", stage: "transcribing" },
				{ type: "stage", stage: "generating" },
				{
					type: "result",
					result: {
						generationId: "g",
						artifact: artifact('<div class="w-full h-full"><p>💊 1 顆</p></div>', 2),
						warnings: ["原始語音中的藥名可能辨識不清。"],
						timings: { audioDurationMs: 1, asrDurationMs: 1, aiDurationMs: 1, totalDurationMs: 3 }
					}
				}
			])
		);
		installFakeMedia();
		await renderReady();

		await act(async () => fireEvent.click(screen.getByRole("button", { name: "開始錄音" })));
		await act(async () => fireEvent.click(await screen.findByRole("button", { name: "停止錄音並產生" })));

		expect(await screen.findByText("💊 1 顆")).toBeInTheDocument();
		expect(screen.getByText("原始語音中的藥名可能辨識不清。")).toBeInTheDocument();
		const generateCalls = calls.filter(call => call.url === "/api/generate");
		expect(generateCalls).toHaveLength(1);
		const form = generateCalls[0]!.body as FormData;
		expect(form.get("continue")).toBe("false");
		expect(form.get("artifactRevision")).toBe("1");
		expect(form.get("model")).toBe("gpt-fast");
		expect(form.get("reasoningEffort")).toBe("none");
	});

	it("keeps the existing artifact when generation fails", async () => {
		mockServer(() =>
			ndjson([
				{ type: "stage", stage: "transcribing" },
				{ type: "error", error: { code: "NO_SPEECH", message: "沒有辨識到語音，請再試一次。" } }
			])
		);
		installFakeMedia();
		await renderReady();
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "開始錄音" })));
		await act(async () => fireEvent.click(await screen.findByRole("button", { name: "停止錄音並產生" })));
		expect(await screen.findByText("沒有辨識到語音，請再試一次。")).toBeInTheDocument();
		expect(screen.getByText("舊的內容")).toBeInTheDocument();
	});

	it("shows a Traditional Chinese error when the microphone is denied", async () => {
		const calls = mockServer(() => ndjson([]));
		installFakeMedia({ deny: true });
		await renderReady();
		const before = calls.length;
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "開始錄音" })));
		expect(await screen.findByText("無法使用麥克風，請確認瀏覽器權限。")).toBeInTheDocument();
		expect(calls.length).toBe(before);
	});
});
