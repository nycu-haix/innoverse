import { describe, expect, it } from "vitest";
import { AppDatabase } from "../src/db/database";

const workspaceId = "3f2c1b8e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";

describe("AppDatabase optimistic concurrency", () => {
	it("creates revision 1 from base revision 0", () => {
		const db = new AppDatabase(":memory:");
		const result = db.saveArtifact({ workspaceId, mode: "document", content: "# a", warnings: [], baseRevision: 0, codexThreadId: "t1" });
		expect(result).toMatchObject({ ok: true, artifact: { revision: 1, content: "# a", codexThreadId: "t1" } });
		db.close();
	});

	it("increments on every update and keeps the thread for manual edits", () => {
		const db = new AppDatabase(":memory:");
		db.saveArtifact({ workspaceId, mode: "document", content: "v1", warnings: [], baseRevision: 0, codexThreadId: "t1" });
		const edit = db.saveArtifact({ workspaceId, mode: "document", content: "v2", warnings: [], baseRevision: 1 });
		expect(edit).toMatchObject({ ok: true, artifact: { revision: 2, content: "v2", codexThreadId: "t1" } });
		const fresh = db.saveArtifact({ workspaceId, mode: "document", content: "v3", warnings: [], baseRevision: 2, codexThreadId: "t2" });
		expect(fresh).toMatchObject({ ok: true, artifact: { revision: 3, codexThreadId: "t2" } });
		db.close();
	});

	it("rejects writes based on a stale revision", () => {
		const db = new AppDatabase(":memory:");
		db.saveArtifact({ workspaceId, mode: "document", content: "v1", warnings: [], baseRevision: 0 });
		db.saveArtifact({ workspaceId, mode: "document", content: "manual edit", warnings: [], baseRevision: 1 });
		const stale = db.saveArtifact({ workspaceId, mode: "document", content: "old generation", warnings: [], baseRevision: 1 });
		expect(stale).toMatchObject({ ok: false, reason: "conflict", current: { revision: 2, content: "manual edit" } });
		const duplicateCreate = db.saveArtifact({ workspaceId, mode: "document", content: "x", warnings: [], baseRevision: 0 });
		expect(duplicateCreate.ok).toBe(false);
		expect(db.getArtifact(workspaceId, "document")?.content).toBe("manual edit");
		db.close();
	});

	it("keeps presentation and document artifacts independent", () => {
		const db = new AppDatabase(":memory:");
		db.saveArtifact({ workspaceId, mode: "document", content: "doc", warnings: [], baseRevision: 0 });
		db.saveArtifact({ workspaceId, mode: "presentation", content: "<div>slide</div>", warnings: ["w"], baseRevision: 0 });
		const workspace = db.getWorkspace(workspaceId);
		expect(workspace.artifacts.document?.content).toBe("doc");
		expect(workspace.artifacts.presentation).toMatchObject({ content: "<div>slide</div>", warnings: ["w"], revision: 1 });
		db.close();
	});
});
