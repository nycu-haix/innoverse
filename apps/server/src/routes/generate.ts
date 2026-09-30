import { GENERATE_METADATA_FIELDS, GenerateMetadataSchema, type GenerationEvent } from "@innoverse/shared";
import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppDependencies } from "../app";
import { AppError, toAppError } from "../errors";
import { parseInput } from "./validate";

const ALLOWED_AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave", "video/webm"]);

/** `audio/webm;codecs=opus` → `audio/webm`. */
export function normalizeMimeType(value: string): string {
	return (value.split(";")[0] ?? "").trim().toLowerCase();
}

const metadataFieldNames: ReadonlySet<string> = new Set(GENERATE_METADATA_FIELDS);

export function registerGenerateRoutes(app: FastifyInstance, deps: AppDependencies): void {
	app.post("/generate", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
		if (!request.isMultipart()) throw new AppError("BAD_REQUEST", { detail: "expected multipart/form-data" });

		const fields: Record<string, string> = {};
		let tempDir: string | null = null;
		let audioPath: string | null = null;
		let mimeType = "";
		let handedOff = false;

		try {
			for await (const part of request.parts()) {
				if (part.type === "field") {
					if (metadataFieldNames.has(part.fieldname) && typeof part.value === "string") fields[part.fieldname] = part.value;
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
				// Raw audio is only ever written to a private temp dir and removed afterwards.
				tempDir = await mkdtemp(path.join(tmpdir(), "innoverse-upload-"));
				audioPath = path.join(tempDir, "audio");
				await pipeline(part.file, createWriteStream(audioPath, { mode: 0o600 }));
				if (part.file.truncated) throw new AppError("UPLOAD_TOO_LARGE");
			}

			if (!audioPath || !tempDir) throw new AppError("EMPTY_RECORDING");
			if ((await stat(audioPath)).size === 0) throw new AppError("EMPTY_RECORDING");

			const metadata = parseInput(GenerateMetadataSchema, fields);
			const prepared = await deps.generation.prepare(metadata);

			// From here on, progress and the final result are streamed as NDJSON events.
			const stream = new PassThrough();
			const send = (event: GenerationEvent) => {
				if (!stream.writableEnded) stream.write(`${JSON.stringify(event)}\n`);
			};
			const cleanupDir = tempDir;
			handedOff = true;
			void deps.generation
				.run(prepared, { filePath: audioPath, mimeType }, stage => send({ type: "stage", stage }))
				.then(result => send({ type: "result", result }))
				.catch(error => send({ type: "error", error: toAppError(error).toBody().error }))
				.finally(() => {
					stream.end();
					void rm(cleanupDir, { recursive: true, force: true });
				});

			reply.header("cache-control", "no-store").header("x-accel-buffering", "no").type("application/x-ndjson; charset=utf-8");
			return reply.send(stream);
		} finally {
			if (!handedOff && tempDir) await rm(tempDir, { recursive: true, force: true });
		}
	});
}
