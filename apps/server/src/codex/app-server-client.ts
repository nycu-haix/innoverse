import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** Minimal child-process surface used by the client, so tests can substitute a fake. */
export interface ChildProcessLike {
	readonly stdin: Writable | null;
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	kill(signal?: NodeJS.Signals): boolean;
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
	on(event: "error", listener: (error: Error) => void): this;
}

export type SpawnFunction = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcessLike;

export type JsonRpcId = number | string;

export type JsonRpcNotification = { method: string; params?: unknown };
export type JsonRpcServerRequest = { id: JsonRpcId; method: string; params?: unknown };

export type ClientState = "stopped" | "starting" | "ready" | "restarting" | "closed";

type Logger = {
	debug(obj: object, msg?: string): void;
	info(obj: object, msg?: string): void;
	warn(obj: object, msg?: string): void;
	error(obj: object, msg?: string): void;
};

export type CodexAppServerClientOptions = {
	command: string;
	/** Defaults to `app-server --listen stdio://`. Never built from user input. */
	args?: readonly string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	logger: Logger;
	clientInfo: { name: string; title: string; version: string };
	/** Notification methods we never consume; suppressed to cut stdio traffic. */
	optOutNotificationMethods?: string[];
	spawn?: SpawnFunction;
	requestTimeoutMs?: number;
	restart?: { initialDelayMs: number; maxDelayMs: number; stableAfterMs: number };
	/** Handles server-initiated requests (approvals etc.). Must never grant broad access. */
	onServerRequest?: (request: JsonRpcServerRequest) => Promise<unknown> | unknown;
};

/** JSON-RPC error returned by the app-server. */
export class CodexRpcError extends Error {
	readonly code: number;
	readonly data: unknown;

	constructor(method: string, error: { code?: unknown; message?: unknown; data?: unknown }) {
		super(`${method} failed: ${typeof error.message === "string" ? error.message : "unknown error"}`);
		this.name = "CodexRpcError";
		this.code = typeof error.code === "number" ? error.code : -32000;
		this.data = error.data;
	}
}

/** The app-server process is unavailable (not started, crashed, restarting or closed). */
export class CodexProcessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodexProcessError";
	}
}

export class CodexTimeoutError extends Error {
	constructor(method: string, timeoutMs: number) {
		super(`${method} timed out after ${timeoutMs}ms`);
		this.name = "CodexTimeoutError";
	}
}

type Pending = {
	method: string;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout | undefined;
};

const DEFAULT_ARGS = ["app-server", "--listen", "stdio://"] as const;

/**
 * Client for one persistent `codex app-server --listen stdio://` child process.
 *
 * Messages are newline-delimited JSON-RPC 2.0 objects (the app-server omits the
 * `jsonrpc` header). Responses are correlated by request id; notifications are
 * re-emitted as `notification` events. On unexpected exit all pending requests
 * are rejected and the process is restarted with bounded exponential backoff.
 *
 * Events: `ready`, `exit` ({ code, signal }), `notification` (JsonRpcNotification).
 */
export class CodexAppServerClient extends EventEmitter {
	private readonly options: Required<Pick<CodexAppServerClientOptions, "requestTimeoutMs" | "restart">> & CodexAppServerClientOptions;
	private child: ChildProcessLike | null = null;
	private nextId = 1;
	private readonly pending = new Map<JsonRpcId, Pending>();
	private stateValue: ClientState = "stopped";
	private restartAttempt = 0;
	private restartTimer: NodeJS.Timeout | undefined;
	private stableTimer: NodeJS.Timeout | undefined;
	private startPromise: Promise<void> | null = null;

	constructor(options: CodexAppServerClientOptions) {
		super();
		this.options = {
			requestTimeoutMs: 30_000,
			restart: { initialDelayMs: 1_000, maxDelayMs: 60_000, stableAfterMs: 60_000 },
			...options
		};
	}

	get state(): ClientState {
		return this.stateValue;
	}

	get isReady(): boolean {
		return this.stateValue === "ready";
	}

	/** Spawn the process and complete the initialize handshake. */
	start(): Promise<void> {
		if (this.stateValue === "closed") return Promise.reject(new CodexProcessError("Codex client is closed"));
		if (this.stateValue === "ready") return Promise.resolve();
		this.startPromise ??= this.spawnAndInitialize().finally(() => {
			this.startPromise = null;
		});
		return this.startPromise;
	}

	private async spawnAndInitialize(): Promise<void> {
		this.stateValue = "starting";
		const spawnFn: SpawnFunction = this.options.spawn ?? ((command, args, options) => nodeSpawn(command, [...args], options));
		let child: ChildProcessLike;
		try {
			// Arguments are a fixed array and `shell` is never enabled.
			child = spawnFn(this.options.command, this.options.args ?? DEFAULT_ARGS, {
				cwd: this.options.cwd,
				env: this.options.env,
				stdio: ["pipe", "pipe", "pipe"],
				shell: false,
				windowsHide: true
			});
		} catch (error) {
			this.scheduleRestart(null, null);
			throw new CodexProcessError(`Failed to spawn Codex app-server: ${error instanceof Error ? error.message : String(error)}`);
		}
		this.child = child;

		child.on("error", error => {
			this.options.logger.error({ err: error }, "codex app-server process error");
			this.handleExit(child, null, null);
		});
		child.on("exit", (code, signal) => this.handleExit(child, code, signal));

		if (child.stdout) {
			const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
			lines.on("line", line => this.handleLine(line));
		}
		if (child.stderr) {
			// Codex logs go to stderr. Keep only a bounded, single-line excerpt at debug level.
			const errLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
			errLines.on("line", line => {
				if (line.trim()) this.options.logger.debug({ codexStderr: line.slice(0, 300) }, "codex app-server stderr");
			});
		}

		try {
			await this.sendRequest("initialize", {
				clientInfo: this.options.clientInfo,
				capabilities: {
					experimentalApi: false,
					requestAttestation: false,
					optOutNotificationMethods: this.options.optOutNotificationMethods ?? null
				}
			});
			this.write({ method: "initialized" });
		} catch (error) {
			if (this.child === child) {
				child.kill("SIGTERM");
			}
			throw error;
		}

		if (this.child !== child || (this.stateValue as ClientState) === "closed") throw new CodexProcessError("Codex app-server exited during startup");
		this.stateValue = "ready";
		clearTimeout(this.stableTimer);
		this.stableTimer = setTimeout(() => {
			this.restartAttempt = 0;
		}, this.options.restart.stableAfterMs);
		this.stableTimer.unref?.();
		this.options.logger.info({}, "codex app-server ready");
		this.emit("ready");
	}

	/** Send a JSON-RPC request. Only callable once the handshake completed. */
	request<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T> {
		if (this.stateValue !== "ready") return Promise.reject(new CodexProcessError(`Codex app-server is ${this.stateValue}`));
		return this.sendRequest(method, params, options) as Promise<T>;
	}

	notify(method: string, params?: unknown): void {
		if (this.stateValue !== "ready") throw new CodexProcessError(`Codex app-server is ${this.stateValue}`);
		this.write(params === undefined ? { method } : { method, params });
	}

	private sendRequest(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<unknown> {
		const id = this.nextId++;
		const timeoutMs = options?.timeoutMs ?? this.options.requestTimeoutMs;
		return new Promise((resolve, reject) => {
			const pending: Pending = { method, resolve, reject, timer: undefined };
			if (timeoutMs > 0) {
				pending.timer = setTimeout(() => {
					this.pending.delete(id);
					reject(new CodexTimeoutError(method, timeoutMs));
				}, timeoutMs);
			}
			this.pending.set(id, pending);
			try {
				this.write(params === undefined ? { id, method } : { id, method, params });
			} catch (error) {
				clearTimeout(pending.timer);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new CodexProcessError(String(error)));
			}
		});
	}

	private write(message: object): void {
		const stdin = this.child?.stdin;
		if (!stdin || stdin.destroyed || !stdin.writable) throw new CodexProcessError("Codex app-server stdin is not writable");
		stdin.write(`${JSON.stringify(message)}\n`);
	}

	private handleLine(line: string): void {
		if (!line.trim()) return;
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			this.options.logger.warn({ length: line.length }, "codex app-server emitted a non-JSON line");
			return;
		}
		if (typeof message !== "object" || message === null) return;
		const record = message as Record<string, unknown>;
		const hasId = typeof record.id === "number" || typeof record.id === "string";
		const method = typeof record.method === "string" ? record.method : undefined;

		if (hasId && method) {
			void this.handleServerRequest({ id: record.id as JsonRpcId, method, params: record.params });
			return;
		}
		if (hasId) {
			const pending = this.pending.get(record.id as JsonRpcId);
			if (!pending) return;
			this.pending.delete(record.id as JsonRpcId);
			clearTimeout(pending.timer);
			if (record.error && typeof record.error === "object") {
				pending.reject(new CodexRpcError(pending.method, record.error as Record<string, unknown>));
			} else {
				pending.resolve(record.result);
			}
			return;
		}
		if (method) {
			this.emit("notification", { method, params: record.params } satisfies JsonRpcNotification);
		}
	}

	private async handleServerRequest(request: JsonRpcServerRequest): Promise<void> {
		try {
			if (!this.options.onServerRequest) throw new Error("unsupported");
			const result = await this.options.onServerRequest(request);
			this.write({ id: request.id, result });
		} catch {
			try {
				this.write({ id: request.id, error: { code: -32601, message: `Unsupported server request: ${request.method}` } });
			} catch {
				// Process already gone; nothing to answer.
			}
		}
	}

	private handleExit(child: ChildProcessLike, code: number | null, signal: NodeJS.Signals | null): void {
		if (this.child !== child) return;
		this.child = null;
		clearTimeout(this.stableTimer);
		const wasClosing = this.stateValue === "closed";
		this.rejectAllPending(new CodexProcessError(wasClosing ? "Codex app-server was shut down" : `Codex app-server exited (code ${code ?? "null"}, signal ${signal ?? "null"})`));
		this.emit("exit", { code, signal });
		if (wasClosing) return;

		this.options.logger.warn({ code, signal }, "codex app-server exited unexpectedly");
		this.scheduleRestart(code, signal);
	}

	/** Bounded exponential backoff; never a tight restart loop. */
	private scheduleRestart(code: number | null, signal: NodeJS.Signals | null): void {
		this.stateValue = "restarting";
		const delay = Math.min(this.options.restart.maxDelayMs, this.options.restart.initialDelayMs * 2 ** this.restartAttempt);
		this.restartAttempt++;
		this.options.logger.info({ code, signal, restartInMs: delay, attempt: this.restartAttempt }, "scheduling codex app-server restart");
		clearTimeout(this.restartTimer);
		this.restartTimer = setTimeout(() => {
			if (this.stateValue !== "restarting") return;
			// Failures schedule the next attempt themselves (via exit or spawn failure).
			this.start().catch(error => this.options.logger.error({ err: error }, "codex app-server restart failed"));
		}, delay);
		this.restartTimer.unref?.();
	}

	private rejectAllPending(error: Error): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			this.pending.delete(id);
		}
	}

	/** Graceful shutdown: close stdin, then SIGTERM, then SIGKILL. */
	async close(timeoutMs = 5_000): Promise<void> {
		if (this.stateValue === "closed") return;
		this.stateValue = "closed";
		clearTimeout(this.restartTimer);
		clearTimeout(this.stableTimer);
		const child = this.child;
		if (!child) {
			this.rejectAllPending(new CodexProcessError("Codex app-server was shut down"));
			return;
		}
		await new Promise<void>(resolve => {
			const killTimer = setTimeout(() => {
				child.kill("SIGKILL");
				resolve();
			}, timeoutMs);
			killTimer.unref?.();
			child.on("exit", () => {
				clearTimeout(killTimer);
				resolve();
			});
			child.stdin?.end();
			child.kill("SIGTERM");
		});
		this.child = null;
		this.rejectAllPending(new CodexProcessError("Codex app-server was shut down"));
	}
}
