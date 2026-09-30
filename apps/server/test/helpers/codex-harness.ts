import { CodexAppServerClient } from "../../src/codex/app-server-client";
import { CodexService } from "../../src/codex/codex-service";
import { FakeChild, fakeSpawn, initializeHandler, silentLogger } from "./fake-codex";

export type HarnessOptions = {
	authenticated?: boolean;
	/** Final agent message for each turn (JSON text). */
	reply?: (turnInput: string) => string;
	resumeFails?: boolean;
	turnStatus?: "completed" | "failed";
	turnError?: unknown;
	/** Accept turn/start but never complete the turn. */
	hangTurns?: boolean;
};

export const MODEL_LIST = {
	data: [
		{
			id: "gpt-fast",
			model: "gpt-fast",
			displayName: "GPT Fast",
			description: "",
			hidden: false,
			supportedReasoningEfforts: [{ reasoningEffort: "none" }, { reasoningEffort: "low" }],
			defaultReasoningEffort: "low",
			isDefault: true
		},
		{
			id: "gpt-deep",
			model: "gpt-deep",
			displayName: "GPT Deep",
			description: "",
			hidden: false,
			supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }],
			defaultReasoningEffort: "medium",
			isDefault: false
		},
		{ id: "gpt-secret", model: "gpt-secret", displayName: "Hidden", description: "", hidden: true, supportedReasoningEfforts: [], defaultReasoningEffort: "low", isDefault: false }
	],
	nextCursor: null
};

/** A CodexService wired to a scripted fake app-server. */
export async function createCodexHarness(options: HarnessOptions = {}) {
	let threadCounter = 0;
	let turnCounter = 0;
	const turns: Array<{ threadId: string; input: string; params: Record<string, unknown> }> = [];
	const fake = fakeSpawn(
		() =>
			new FakeChild({
				initialize: initializeHandler,
				"account/read": () => ({ account: options.authenticated === false ? null : { type: "chatgpt", email: "user@example.com", planType: "plus" }, requiresOpenaiAuth: true }),
				"model/list": () => MODEL_LIST,
				"thread/start": () => ({ thread: { id: `thread-new-${++threadCounter}` } }),
				"thread/resume": (params: unknown) => {
					if (options.resumeFails) throw new Error("thread not found");
					return { thread: { id: (params as { threadId: string }).threadId } };
				},
				"turn/start": (params: unknown, child: FakeChild) => {
					const p = params as { threadId: string; input: Array<{ text: string }> } & Record<string, unknown>;
					const turnId = `turn-${++turnCounter}`;
					const input = p.input[0]?.text ?? "";
					turns.push({ threadId: p.threadId, input, params: p });
					if (options.hangTurns) return { turn: { id: turnId, items: [], status: "inProgress", error: null } };
					setImmediate(() => {
						if ((options.turnStatus ?? "completed") === "completed") {
							child.notify("item/completed", { threadId: p.threadId, turnId, item: { type: "agentMessage", id: "m1", text: options.reply?.(input) ?? "{}", phase: "final_answer" }, completedAtMs: 0 });
						}
						child.notify("turn/completed", { threadId: p.threadId, turn: { id: turnId, items: [], status: options.turnStatus ?? "completed", error: options.turnError ?? null } });
					});
					return { turn: { id: turnId, items: [], status: "inProgress", error: null } };
				}
			})
	);
	const client = new CodexAppServerClient({
		command: "codex",
		cwd: "/tmp",
		env: {},
		logger: silentLogger,
		clientInfo: { name: "test", title: "test", version: "0" },
		spawn: fake.spawn,
		onServerRequest: request => CodexService.handleServerRequest(request)
	});
	const service = new CodexService(client, { runtimeDir: "/tmp/runtime", turnTimeoutMs: 5_000, modelCacheMs: 60_000, logger: silentLogger });
	await client.start();
	await service.refreshAccount();
	const methods = () => fake.children.flatMap(child => child.received.map(message => message.method).filter(Boolean));
	return { client, service, turns, methods, children: fake.children };
}
