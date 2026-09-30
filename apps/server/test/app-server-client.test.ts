import { describe, expect, it, vi } from "vitest";
import { CodexAppServerClient, CodexProcessError, CodexRpcError } from "../src/codex/app-server-client";
import { FakeChild, fakeSpawn, initializeHandler, silentLogger } from "./helpers/fake-codex";

function makeClient(handlers: ConstructorParameters<typeof FakeChild>[0] = {}, restart = { initialDelayMs: 1_000, maxDelayMs: 8_000, stableAfterMs: 60_000 }) {
	const fake = fakeSpawn(() => new FakeChild({ initialize: initializeHandler, ...handlers }));
	const client = new CodexAppServerClient({
		command: "codex",
		cwd: "/tmp",
		env: {},
		logger: silentLogger,
		clientInfo: { name: "test", title: "test", version: "0" },
		spawn: fake.spawn,
		restart,
		onServerRequest: request => (request.method === "item/commandExecution/requestApproval" ? { decision: "decline" } : Promise.reject(new Error("no")))
	});
	return { client, ...fake };
}

describe("CodexAppServerClient", () => {
	it("spawns app-server over stdio without a shell and performs the handshake", async () => {
		const { client, calls, children } = makeClient();
		await client.start();
		expect(calls).toEqual([{ command: "codex", args: ["app-server", "--listen", "stdio://"], shell: false }]);
		const methods = children[0]!.received.map(message => message.method);
		expect(methods).toEqual(["initialize", "initialized"]);
		expect(client.state).toBe("ready");
		await client.close();
	});

	it("correlates responses to requests by id, even out of order", async () => {
		const pending: Array<{ id: number; value: string }> = [];
		const { client, children } = makeClient({ "slow/a": () => undefined, "slow/b": () => undefined });
		await client.start();
		const child = children[0]!;
		const a = client.request<string>("slow/a", {});
		const b = client.request<string>("slow/b", {});
		await new Promise(resolve => setImmediate(resolve));
		for (const message of child.received) {
			if (message.method === "slow/a") pending.push({ id: message.id as number, value: "A" });
			if (message.method === "slow/b") pending.push({ id: message.id as number, value: "B" });
		}
		// Answer b first, then a.
		child.send({ id: pending[1]!.id, result: pending[1]!.value });
		child.send({ id: pending[0]!.id, result: pending[0]!.value });
		await expect(a).resolves.toBe("A");
		await expect(b).resolves.toBe("B");
		expect(pending[0]!.id).not.toBe(pending[1]!.id);
		await client.close();
	});

	it("rejects with CodexRpcError on JSON-RPC errors", async () => {
		const { client } = makeClient();
		await client.start();
		await expect(client.request("unknown/method")).rejects.toBeInstanceOf(CodexRpcError);
		await client.close();
	});

	it("emits notifications and answers server requests", async () => {
		const { client, children } = makeClient();
		await client.start();
		const notifications: unknown[] = [];
		client.on("notification", notification => notifications.push(notification));
		const child = children[0]!;
		child.notify("account/updated", { authMode: null });
		child.send({ id: "srv-1", method: "item/commandExecution/requestApproval", params: {} });
		child.send({ id: "srv-2", method: "item/tool/call", params: {} });
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(notifications).toEqual([{ method: "account/updated", params: { authMode: null } }]);
		expect(child.received.find(message => message.id === "srv-1")).toMatchObject({ result: { decision: "decline" } });
		expect(child.received.find(message => message.id === "srv-2")).toHaveProperty("error");
		await client.close();
	});

	it("rejects pending requests when the process crashes and restarts with bounded backoff", async () => {
		const { client, children, calls } = makeClient({ "never/answers": () => undefined }, { initialDelayMs: 40, maxDelayMs: 100, stableAfterMs: 60_000 });
		await client.start();
		const pending = client.request("never/answers", {}, { timeoutMs: 0 });
		const exits: unknown[] = [];
		client.on("exit", event => exits.push(event));

		let crashedAt = Date.now();
		children[0]!.crash(137);
		await expect(pending).rejects.toBeInstanceOf(CodexProcessError);
		expect(client.state).toBe("restarting");
		expect(exits).toEqual([{ code: 137, signal: null }]);
		await expect(client.request("anything")).rejects.toBeInstanceOf(CodexProcessError);
		expect(calls).toHaveLength(1);

		await vi.waitFor(() => expect(client.state).toBe("ready"));
		expect(calls).toHaveLength(2);
		expect(Date.now() - crashedAt).toBeGreaterThanOrEqual(35);

		// The next crash waits twice as long; delays are capped at maxDelayMs.
		crashedAt = Date.now();
		children[1]!.crash(1);
		await vi.waitFor(() => expect(client.state).toBe("ready"));
		expect(Date.now() - crashedAt).toBeGreaterThanOrEqual(75);
		crashedAt = Date.now();
		children[2]!.crash(1);
		await vi.waitFor(() => expect(client.state).toBe("ready"), { timeout: 2_000 });
		expect(Date.now() - crashedAt).toBeLessThan(400);
		await client.close();
	});

	it("rejects pending requests on graceful shutdown and does not restart", async () => {
		const { client, calls } = makeClient({ "never/answers": () => undefined });
		await client.start();
		const pending = client.request("never/answers", {}, { timeoutMs: 0 });
		await client.close();
		await expect(pending).rejects.toBeInstanceOf(CodexProcessError);
		expect(client.state).toBe("closed");
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(calls).toHaveLength(1);
	});
});
