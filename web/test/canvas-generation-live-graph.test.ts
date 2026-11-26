import { expect, test } from "bun:test";
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("delayed second regeneration uses live graph while retaining confirmed billing inputs", async () => {
    // The fixture mocks module boundaries, so it must run in its own process.
    // Redirect its stdio to files: sandboxed runs cannot hand a child a named pipe.
    const dir = mkdtempSync(join(tmpdir(), "siflux-live-graph-"));
    const stdoutPath = join(dir, "stdout.log");
    const stderrPath = join(dir, "stderr.log");
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    try {
        const child = Bun.spawn([process.execPath, "run", "test/fixtures/generation-live-graph.fixture.ts"], { cwd: join(import.meta.dir, ".."), stdout: stdoutFd, stderr: stderrFd });
        const status = await child.exited;
        expect(status).toBe(0);
        expect(readFileSync(stderrPath, "utf8")).toBe("");
        expect(readFileSync(stdoutPath, "utf8")).toContain("PASS: shared frozen inputs");
    } finally {
        closeSync(stdoutFd);
        closeSync(stderrFd);
        rmSync(dir, { recursive: true, force: true });
    }
}, 15000);
