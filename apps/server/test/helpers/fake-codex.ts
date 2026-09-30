import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessLike, SpawnFunction } from "../../src/codex/app-server-client";

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

type Handler = (params: unknown, child: FakeChild) => unknown;

/** In-memory stand-in for `codex app-server`: reads JSON-RPC lines, replies via handlers. */
export class FakeChild extends EventEmitter implements ChildProcessLike {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly received: Array<{ id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown }> = [];
	killed = false;
	private buffer = "";

	constructor(
		private readonly handlers: Record<string, Handler>,
		private readonly autoRespond = true
	) {
		super();
		this.stdin.on("data", chunk => {
			this.buffer += chunk.toString();
			let index: number;
			while ((index = this.buffer.indexOf("\n")) >= 0) {
				const line = this.buffer.slice(0, index);
				this.buffer = this.buffer.slice(index + 1);
				this.handle(JSON.parse(line));
			}
		});
	}

	private handle(message: { id?: number | string; method?: string; params?: unknown }) {
		this.received.push(message);
		if (!this.autoRespond || message.id === undefined || !message.method) return;
		const handler = this.handlers[message.method];
		if (!handler) {
			this.send({ id: message.id, error: { code: -32601, message: `no handler for ${message.method}` } });
			return;
		}
		try {
			const result = handler(message.params, this);
			if (result !== undefined) this.send({ id: message.id, result });
		} catch (error) {
			this.send({ id: message.id, error: { code: -32000, message: (error as Error).message } });
		}
	}

	send(message: object) {
		this.stdout.write(`${JSON.stringify(message)}\n`);
	}

	notify(method: string, params: unknown) {
		this.send({ method, params });
	}

	kill(): boolean {
		this.killed = true;
		setImmediate(() => this.emit("exit", null, "SIGTERM"));
		return true;
	}

	crash(code = 1) {
		this.emit("exit", code, null);
	}
}

export function fakeSpawn(factory: () => FakeChild): { spawn: SpawnFunction; children: FakeChild[]; calls: Array<{ command: string; args: readonly string[]; shell: unknown }> } {
	const children: FakeChild[] = [];
	const calls: Array<{ command: string; args: readonly string[]; shell: unknown }> = [];
	const spawn: SpawnFunction = (command, args, options) => {
		calls.push({ command, args, shell: options.shell });
		const child = factory();
		children.push(child);
		return child;
	};
	return { spawn, children, calls };
}

export const initializeHandler = () => ({ userAgent: "fake", codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "linux" });
