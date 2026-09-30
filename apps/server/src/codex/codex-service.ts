import type { AuthStatus, DeviceLogin, ModelOption } from "@innoverse/shared";
import { AppError } from "../errors";
import { CodexProcessError, CodexRpcError, CodexTimeoutError, type CodexAppServerClient, type JsonRpcNotification, type JsonRpcServerRequest } from "./app-server-client";
import {
	AgentMessageItemSchema,
	codexErrorKind,
	CodexModelSchema,
	DeviceCodeLoginResponseSchema,
	ErrorNotificationSchema,
	GetAccountResponseSchema,
	ItemCompletedNotificationSchema,
	LoginCompletedNotificationSchema,
	ModelListResponseSchema,
	ThreadResponseSchema,
	TurnCompletedNotificationSchema,
	TurnStartResponseSchema,
	type CodexModel,
	type GetAccountResponse,
	type TurnError
} from "./protocol";

type Logger = {
	info(obj: object, msg?: string): void;
	warn(obj: object, msg?: string): void;
	error(obj: object, msg?: string): void;
};

/** The subset of CodexAppServerClient used here (keeps the service testable). */
export type AppServerConnection = Pick<CodexAppServerClient, "request" | "isReady" | "state" | "on" | "off">;

export type RunTurnInput = {
	/** Existing thread to continue. `null` always starts a fresh thread. */
	threadId: string | null;
	model: string;
	reasoningEffort: string | null;
	developerInstructions: string;
	input: string;
	outputSchema: object;
};

export type RunTurnResult = {
	threadId: string;
	/** Whether a previous thread was resumed (false when a fresh thread was created). */
	resumed: boolean;
	text: string;
};

export type CodexServiceOptions = {
	runtimeDir: string;
	turnTimeoutMs: number;
	modelCacheMs: number;
	logger: Logger;
};

/**
 * Domain-level wrapper over the app-server: authentication, model catalog and
 * single structured-output turns. Exposes no generic JSON-RPC passthrough.
 */
export class CodexService {
	private account: GetAccountResponse | null = null;
	private pendingLogin: DeviceLogin | null = null;
	private loginError: string | null = null;
	private modelCache: { at: number; models: CodexModel[] } | null = null;

	constructor(
		private readonly client: AppServerConnection,
		private readonly options: CodexServiceOptions
	) {
		client.on("notification", (notification: JsonRpcNotification) => this.handleNotification(notification));
		client.on("ready", () => {
			this.modelCache = null;
			void this.refreshAccount().catch(error => options.logger.warn({ err: error }, "account/read failed after app-server start"));
		});
		client.on("exit", () => {
			this.pendingLogin = null;
		});
	}

	/**
	 * Answers server-initiated requests. Generation runs with a read-only sandbox and
	 * `approvalPolicy: never`, so approvals should never be requested; if they are,
	 * they are always declined.
	 */
	static handleServerRequest(request: JsonRpcServerRequest): unknown {
		switch (request.method) {
			case "item/commandExecution/requestApproval":
			case "item/fileChange/requestApproval":
				return { decision: "decline" };
			case "execCommandApproval":
			case "applyPatchApproval":
				return { decision: "abort" };
			case "mcpServer/elicitation/request":
				return { action: "decline", content: null, _meta: null };
			default:
				throw new Error(`unsupported server request ${request.method}`);
		}
	}

	private handleNotification(notification: JsonRpcNotification): void {
		if (notification.method === "account/login/completed") {
			const parsed = LoginCompletedNotificationSchema.safeParse(notification.params);
			if (!parsed.success) return;
			if (this.pendingLogin && parsed.data.loginId && parsed.data.loginId !== this.pendingLogin.loginId) return;
			this.pendingLogin = null;
			this.loginError = parsed.data.success ? null : "登入失敗，請再試一次。";
			this.options.logger.info({ success: parsed.data.success }, "codex device login completed");
			void this.refreshAccount().catch(() => undefined);
		} else if (notification.method === "account/updated") {
			void this.refreshAccount().catch(() => undefined);
		}
	}

	async refreshAccount(): Promise<GetAccountResponse> {
		const result = GetAccountResponseSchema.parse(await this.client.request("account/read", { refreshToken: false }));
		this.account = result;
		return result;
	}

	get processState(): string {
		return this.client.state;
	}

	get isAuthenticated(): boolean {
		if (!this.account) return false;
		return this.account.account !== null || !this.account.requiresOpenaiAuth;
	}

	async getAuthStatus(): Promise<AuthStatus> {
		const codexAvailable = this.client.isReady;
		if (codexAvailable && !this.account) {
			await this.refreshAccount().catch(error => this.options.logger.warn({ err: error }, "account/read failed"));
		}
		const account = this.account?.account ?? null;
		return {
			codexAvailable,
			authenticated: codexAvailable && this.isAuthenticated,
			account: account ? { type: account.type, email: account.email ?? null, planType: account.planType ?? null } : null,
			pendingLogin: this.pendingLogin,
			loginError: this.loginError
		};
	}

	async startDeviceLogin(): Promise<DeviceLogin> {
		if (this.pendingLogin) return this.pendingLogin;
		const response = await this.callOrThrow("account/login/start", { type: "chatgptDeviceCode" }, "LOGIN_FAILED");
		const parsed = DeviceCodeLoginResponseSchema.safeParse(response);
		if (!parsed.success) throw new AppError("LOGIN_FAILED", { detail: "unexpected login response" });
		this.loginError = null;
		this.pendingLogin = { loginId: parsed.data.loginId, verificationUrl: parsed.data.verificationUrl, userCode: parsed.data.userCode };
		return this.pendingLogin;
	}

	async cancelLogin(): Promise<void> {
		const pending = this.pendingLogin;
		this.pendingLogin = null;
		if (!pending) return;
		await this.callOrThrow("account/login/cancel", { loginId: pending.loginId }, "LOGIN_FAILED").catch(error => {
			this.options.logger.warn({ err: error }, "account/login/cancel failed");
		});
	}

	async logout(): Promise<void> {
		await this.callOrThrow("account/logout", undefined, "CODEX_UNAVAILABLE");
		this.pendingLogin = null;
		this.modelCache = null;
		await this.refreshAccount().catch(() => undefined);
	}

	/** Visible models from `model/list`, cached briefly. */
	async listModels(): Promise<ModelOption[]> {
		const now = Date.now();
		if (!this.modelCache || now - this.modelCache.at > this.options.modelCacheMs) {
			const models: CodexModel[] = [];
			let cursor: string | null = null;
			for (let page = 0; page < 20; page++) {
				const response = ModelListResponseSchema.parse(await this.callOrThrow("model/list", { cursor, includeHidden: false }, "CODEX_UNAVAILABLE"));
				for (const item of response.data) {
					const parsed = CodexModelSchema.safeParse(item);
					if (parsed.success) models.push(parsed.data);
				}
				cursor = response.nextCursor ?? null;
				if (!cursor) break;
			}
			this.modelCache = { at: now, models };
		}
		return this.modelCache.models.filter(model => !model.hidden).map(sanitizeModel);
	}

	/** Maps our sanitized model id back to the Codex model slug. */
	private async codexModelSlug(id: string): Promise<string> {
		await this.listModels();
		return this.modelCache?.models.find(model => model.id === id)?.model ?? id;
	}

	private threadSettings(model: string, developerInstructions: string) {
		return {
			model,
			cwd: this.options.runtimeDir,
			approvalPolicy: "never",
			sandbox: "read-only",
			developerInstructions
		};
	}

	/**
	 * Resume `threadId` when given (falling back to a fresh thread if resume fails),
	 * run one turn with a structured output schema and return the final message.
	 */
	async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
		if (!this.client.isReady) throw new AppError("CODEX_UNAVAILABLE");
		if (!this.isAuthenticated) {
			await this.refreshAccount().catch(() => undefined);
			if (!this.isAuthenticated) throw new AppError("CODEX_UNAUTHENTICATED");
		}
		const model = await this.codexModelSlug(input.model);
		const settings = this.threadSettings(model, input.developerInstructions);

		let threadId: string | null = null;
		let resumed = false;
		if (input.threadId) {
			try {
				const response = ThreadResponseSchema.parse(await this.client.request("thread/resume", { threadId: input.threadId, excludeTurns: true, ...settings }));
				threadId = response.thread.id;
				resumed = true;
			} catch (error) {
				// Never fail a continuation because an old thread cannot be resumed; the
				// current artifact is always part of the turn input anyway.
				this.options.logger.warn({ err: errorSummary(error) }, "thread/resume failed; starting a fresh thread");
			}
		}
		if (!threadId) {
			const response = ThreadResponseSchema.parse(await this.callOrThrow("thread/start", { ...settings, ephemeral: false }, "CODEX_UNAVAILABLE"));
			threadId = response.thread.id;
		}

		const text = await this.runSingleTurn(threadId, model, input);
		return { threadId, resumed, text };
	}

	private runSingleTurn(threadId: string, model: string, input: RunTurnInput): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			let turnId: string | null = null;
			let finalMessage: string | null = null;
			let lastMessage: string | null = null;
			let fatalError: TurnError | null = null;
			let settled = false;
			const buffered: JsonRpcNotification[] = [];

			const cleanup = () => {
				settled = true;
				clearTimeout(timer);
				this.client.off("notification", onNotification);
				this.client.off("exit", onExit);
			};
			const fail = (error: Error) => {
				if (settled) return;
				cleanup();
				reject(error);
			};
			const onExit = () => fail(new AppError("CODEX_UNAVAILABLE", { detail: "app-server exited during turn" }));

			const handle = (notification: JsonRpcNotification) => {
				if (notification.method === "item/completed") {
					const parsed = ItemCompletedNotificationSchema.safeParse(notification.params);
					if (!parsed.success || parsed.data.threadId !== threadId || parsed.data.turnId !== turnId) return;
					const item = AgentMessageItemSchema.safeParse(parsed.data.item);
					if (!item.success) return;
					lastMessage = item.data.text;
					if (item.data.phase === "final_answer") finalMessage = item.data.text;
				} else if (notification.method === "error") {
					const parsed = ErrorNotificationSchema.safeParse(notification.params);
					if (parsed.success && parsed.data.threadId === threadId && parsed.data.turnId === turnId && !parsed.data.willRetry) fatalError = parsed.data.error;
				} else if (notification.method === "turn/completed") {
					const parsed = TurnCompletedNotificationSchema.safeParse(notification.params);
					if (!parsed.success || parsed.data.threadId !== threadId || parsed.data.turn.id !== turnId) return;
					const turn = parsed.data.turn;
					if (settled) return;
					cleanup();
					if (turn.status === "completed") {
						const text = finalMessage ?? lastMessage;
						if (text === null) reject(new AppError("INVALID_OUTPUT", { detail: "turn completed without an agent message" }));
						else resolve(text);
					} else {
						reject(mapTurnError(turn.error ?? fatalError, turn.status));
					}
				}
			};

			const onNotification = (notification: JsonRpcNotification) => {
				if (turnId === null) buffered.push(notification);
				else handle(notification);
			};

			const timer = setTimeout(() => {
				const currentTurn = turnId;
				fail(new AppError("GENERATION_FAILED", { detail: `turn timed out after ${this.options.turnTimeoutMs}ms` }));
				if (currentTurn) void this.client.request("turn/interrupt", { threadId, turnId: currentTurn }).catch(() => undefined);
			}, this.options.turnTimeoutMs);

			this.client.on("notification", onNotification);
			this.client.on("exit", onExit);

			this.client
				.request("turn/start", {
					threadId,
					input: [{ type: "text", text: input.input, text_elements: [] }],
					model,
					effort: input.reasoningEffort,
					cwd: this.options.runtimeDir,
					approvalPolicy: "never",
					sandboxPolicy: { type: "readOnly", networkAccess: false },
					outputSchema: input.outputSchema
				})
				.then(response => {
					const parsed = TurnStartResponseSchema.parse(response);
					turnId = parsed.turn.id;
					for (const notification of buffered.splice(0)) handle(notification);
				})
				.catch(error => fail(mapRpcError(error, "GENERATION_FAILED")));
		});
	}

	private async callOrThrow(method: string, params: unknown, fallback: "CODEX_UNAVAILABLE" | "LOGIN_FAILED"): Promise<unknown> {
		if (!this.client.isReady) throw new AppError("CODEX_UNAVAILABLE");
		try {
			return await this.client.request(method, params);
		} catch (error) {
			throw mapRpcError(error, fallback);
		}
	}
}

function sanitizeModel(model: CodexModel): ModelOption {
	return {
		id: model.id,
		displayName: model.displayName,
		description: model.description,
		supportedReasoningEfforts: model.supportedReasoningEfforts.map(option => option.reasoningEffort),
		defaultReasoningEffort: model.defaultReasoningEffort,
		isDefault: model.isDefault
	};
}

function mapTurnError(error: TurnError | null | undefined, status: string): AppError {
	const kind = codexErrorKind(error);
	if (kind === "unauthorized") return new AppError("CODEX_UNAUTHENTICATED", { detail: `turn ${status}: unauthorized` });
	if (kind === "usageLimitExceeded" || kind === "rateLimitExceeded" || kind === "serverOverloaded") return new AppError("CODEX_RATE_LIMITED", { detail: `turn ${status}: ${kind}` });
	return new AppError("GENERATION_FAILED", { detail: `turn ${status}: ${kind ?? "unknown"}` });
}

function mapRpcError(error: unknown, fallback: "CODEX_UNAVAILABLE" | "LOGIN_FAILED" | "GENERATION_FAILED"): AppError {
	if (error instanceof AppError) return error;
	if (error instanceof CodexProcessError || error instanceof CodexTimeoutError) return new AppError("CODEX_UNAVAILABLE", { cause: error });
	if (error instanceof CodexRpcError && /unauthori|not logged in|login/i.test(error.message)) return new AppError("CODEX_UNAUTHENTICATED", { cause: error });
	return new AppError(fallback, { cause: error });
}

function errorSummary(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown";
}
