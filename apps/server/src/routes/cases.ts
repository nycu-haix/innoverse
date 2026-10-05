import {
	apiError,
	CaseParamsSchema,
	ItemParamsSchema,
	LineParamsSchema,
	UpdateFactRequestSchema,
	UpdateGapRequestSchema,
	UpdateRecordRequestSchema,
	UpdateSpeakerRequestSchema,
	UTTERANCE_FIELDS,
	UtteranceFieldsSchema
} from "@innoverse/shared";
import type { FastifyInstance } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { AppDependencies } from "../app";
import { AppError } from "../errors";
import { parseInput } from "./validate";

const ALLOWED_AUDIO_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/webm", "audio/ogg", "audio/mp4"]);
const utteranceFieldNames: ReadonlySet<string> = new Set(UTTERANCE_FIELDS);

/** `audio/webm;codecs=opus` → `audio/webm`. */
export function normalizeMimeType(value: string): string {
	return (value.split(";")[0] ?? "").trim().toLowerCase();
}

export function registerCaseRoutes(app: FastifyInstance, deps: AppDependencies): void {
	const { cases } = deps;

	app.get("/cases", async (_request, reply) => {
		reply.header("cache-control", "no-store");
		return { cases: cases.list() };
	});

	app.post("/cases", async (_request, reply) => reply.status(201).send(cases.createCase()));

	app.get("/cases/:caseId", async (request, reply) => {
		const { caseId } = parseInput(CaseParamsSchema, request.params);
		reply.header("cache-control", "no-store");
		return cases.detail(caseId);
	});

	/** Cheap polling endpoint: the client refetches the case when the version changes. */
	app.get("/cases/:caseId/version", async (request, reply) => {
		const { caseId } = parseInput(CaseParamsSchema, request.params);
		reply.header("cache-control", "no-store");
		return { version: cases.version(caseId) };
	});

	/** One utterance cut by the browser's voice activity detection. Fields first, then audio. */
	app.post("/cases/:caseId/utterances", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request, reply) => {
		const { caseId } = parseInput(CaseParamsSchema, request.params);
		if (!request.isMultipart()) throw new AppError("BAD_REQUEST", { detail: "expected multipart/form-data" });

		const fields: Record<string, string> = {};
		let tempDir: string | null = null;
		let audioPath: string | null = null;
		let mimeType = "";
		try {
			for await (const part of request.parts()) {
				if (part.type === "field") {
					if (utteranceFieldNames.has(part.fieldname) && typeof part.value === "string") fields[part.fieldname] = part.value;
					continue;
				}
				if (part.fieldname !== "audio" || audioPath) {
					part.file.resume();
					throw new AppError("BAD_REQUEST", { detail: "unexpected file part" });
				}
				mimeType = normalizeMimeType(part.mimetype);
				if (!ALLOWED_AUDIO_TYPES.has(mimeType)) {
					part.file.resume();
					throw new AppError("UNSUPPORTED_AUDIO", { detail: mimeType });
				}
				tempDir = await mkdtemp(path.join(tmpdir(), "innoverse-utterance-"));
				audioPath = path.join(tempDir, "audio");
				await pipeline(part.file, createWriteStream(audioPath, { mode: 0o600 }));
				if (part.file.truncated) throw new AppError("UPLOAD_TOO_LARGE");
			}
			if (!audioPath || (await stat(audioPath)).size === 0) throw new AppError("EMPTY_RECORDING");
			const timing = parseInput(UtteranceFieldsSchema, fields);
			const utterance = await cases.addUtterance(caseId, { filePath: audioPath, mimeType }, timing);
			return reply.status(201).send(utterance);
		} finally {
			if (tempDir) await rm(tempDir, { recursive: true, force: true });
		}
	});

	app.get("/cases/:caseId/utterances/:lineId/audio", async (request, reply) => {
		const { caseId, lineId } = parseInput(LineParamsSchema, request.params);
		const file = cases.audioFile(caseId, lineId);
		if (!file) throw new AppError("NOT_FOUND");
		try {
			const info = await stat(file);
			reply.header("content-length", info.size);
		} catch {
			throw new AppError("NOT_FOUND");
		}
		reply.header("cache-control", "private, max-age=3600").type("audio/wav");
		return reply.send(createReadStream(file));
	});

	app.put("/cases/:caseId/utterances/:lineId/speaker", async (request, reply) => {
		const { caseId, lineId } = parseInput(LineParamsSchema, request.params);
		const { speaker } = parseInput(UpdateSpeakerRequestSchema, request.body);
		cases.setSpeaker(caseId, lineId, speaker);
		return reply.status(204).send();
	});

	app.put("/cases/:caseId/facts/:itemId", async (request, reply) => {
		const { caseId, itemId } = parseInput(ItemParamsSchema, request.params);
		const { text } = parseInput(UpdateFactRequestSchema, request.body);
		cases.editFact(caseId, itemId, text);
		return reply.status(204).send();
	});

	app.put("/cases/:caseId/gaps/:itemId", async (request, reply) => {
		const { caseId, itemId } = parseInput(ItemParamsSchema, request.params);
		const { state } = parseInput(UpdateGapRequestSchema, request.body);
		cases.setGapState(caseId, itemId, state);
		return reply.status(204).send();
	});

	app.post("/cases/:caseId/analyze", async (request, reply) => {
		const { caseId } = parseInput(CaseParamsSchema, request.params);
		cases.requestAnalysis(caseId);
		return reply.status(202).send();
	});

	app.post("/cases/:caseId/record/generate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async request => {
		const { caseId } = parseInput(CaseParamsSchema, request.params);
		return { record: await cases.generateRecord(caseId) };
	});

	/** Manual edit with optimistic concurrency (baseRevision must match). */
	app.put("/cases/:caseId/record", async (request, reply) => {
		const { caseId } = parseInput(CaseParamsSchema, request.params);
		const body = parseInput(UpdateRecordRequestSchema, request.body);
		const result = cases.saveRecord(caseId, body.content, body.baseRevision);
		if (!result.ok) return reply.status(409).send({ ...apiError("STALE_REVISION"), current: result.current });
		return { record: result.record };
	});
}
