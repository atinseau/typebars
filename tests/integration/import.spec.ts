import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Integration Tests ──────────────────────────────────────────────────────
// Verifies that the published package can be imported in all supported
// runtime × module-system combinations:
//
//   1. Node.js + ESM   (test-esm.mjs)
//   2. Node.js + CJS   (test-cjs.cjs)
//   3. Bun + ESM       (test-esm.mjs)
//   4. Bun + CJS       (test-cjs.cjs)
//
// Each test spawns a child process in the target runtime, executing a
// self-contained script that imports from `dist/` and runs assertions.
// A non-zero exit code signals failure; stdout/stderr are captured for
// diagnostics.

const ROOT = resolve(import.meta.dir, "../..");
const DIST_ESM = resolve(ROOT, "dist/esm/index.js");
const DIST_CJS = resolve(ROOT, "dist/cjs/index.js");

const TEST_ESM = resolve(import.meta.dir, "test-esm.mjs");
const TEST_CJS = resolve(import.meta.dir, "test-cjs.cjs");

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function run(command: string[]): Promise<RunResult> {
	const proc = Bun.spawn(command, {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			// Prevent Node.js experimental warnings from polluting stderr
			NODE_NO_WARNINGS: "1",
		},
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	const exitCode = await proc.exited;

	return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

function formatOutput(result: RunResult): string {
	const parts: string[] = [];
	if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
	if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
	return parts.join("\n");
}

// ─── Pre-flight checks ──────────────────────────────────────────────────────

describe("import integration", () => {
	beforeAll(async () => {
		// Ensure dist/ is built before running integration tests.
		// If the build artifacts are missing, run the build.
		if (!existsSync(DIST_ESM) || !existsSync(DIST_CJS)) {
			const buildResult = await run(["bun", "run", "build"]);
			if (buildResult.exitCode !== 0) {
				throw new Error(
					`Build failed (exit ${buildResult.exitCode}):\n${formatOutput(buildResult)}`,
				);
			}
		}
	});

	// ─── Verify dist artifacts exist ───────────────────────────────────────

	describe("build artifacts", () => {
		test("dist/esm/index.js exists", () => {
			expect(existsSync(DIST_ESM)).toBe(true);
		});

		test("dist/cjs/index.js exists", () => {
			expect(existsSync(DIST_CJS)).toBe(true);
		});

		test("dist/esm/index.d.ts exists", () => {
			expect(existsSync(resolve(ROOT, "dist/esm/index.d.ts"))).toBe(true);
		});

		test("dist/cjs/index.d.ts exists", () => {
			expect(existsSync(resolve(ROOT, "dist/cjs/index.d.ts"))).toBe(true);
		});

		test("dist/cjs/package.json sets type to commonjs", async () => {
			const cjsPkg = await Bun.file(
				resolve(ROOT, "dist/cjs/package.json"),
			).json();
			expect(cjsPkg.type).toBe("commonjs");
		});
	});

	// ─── Node.js ─────────────────────────────────────────────────────────────

	describe("Node.js", () => {
		test("ESM import (node --experimental-vm-modules test-esm.mjs)", async () => {
			const result = await run(["node", TEST_ESM]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("All assertions passed");
		}, 15_000);

		test("CJS require (node test-cjs.cjs)", async () => {
			const result = await run(["node", TEST_CJS]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("All assertions passed");
		}, 15_000);
	});

	// ─── Bun ─────────────────────────────────────────────────────────────────

	describe("Bun", () => {
		test("ESM import (bun test-esm.mjs)", async () => {
			const result = await run(["bun", "run", TEST_ESM]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("All assertions passed");
		}, 15_000);

		test("CJS require (bun test-cjs.cjs)", async () => {
			const result = await run(["bun", "run", TEST_CJS]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("All assertions passed");
		}, 15_000);
	});

	// ─── Package.json exports resolution ─────────────────────────────────────
	// Verify that the exports map in package.json is well-formed by checking
	// that the declared paths actually exist on disk.

	describe("package.json exports map", () => {
		let exports: Record<string, unknown>;

		beforeAll(async () => {
			const pkg = await Bun.file(resolve(ROOT, "package.json")).json();
			exports = pkg.exports;
		});

		test("exports field exists and has '.' entry", () => {
			expect(exports).toBeDefined();
			expect(exports["."]).toBeDefined();
		});

		test("import condition points to existing files", () => {
			const importCondition = (exports["."] as Record<string, unknown>)
				.import as { types: string; default: string };
			expect(importCondition).toBeDefined();
			expect(existsSync(resolve(ROOT, importCondition.types))).toBe(true);
			expect(existsSync(resolve(ROOT, importCondition.default))).toBe(true);
		});

		test("require condition points to existing files", () => {
			const requireCondition = (exports["."] as Record<string, unknown>)
				.require as { types: string; default: string };
			expect(requireCondition).toBeDefined();
			expect(existsSync(resolve(ROOT, requireCondition.types))).toBe(true);
			expect(existsSync(resolve(ROOT, requireCondition.default))).toBe(true);
		});

		test("types condition comes before default in import", () => {
			const importCondition = (exports["."] as Record<string, unknown>)
				.import as Record<string, string>;
			const keys = Object.keys(importCondition);
			const typesIndex = keys.indexOf("types");
			const defaultIndex = keys.indexOf("default");
			expect(typesIndex).toBeLessThan(defaultIndex);
		});

		test("types condition comes before default in require", () => {
			const requireCondition = (exports["."] as Record<string, unknown>)
				.require as Record<string, string>;
			const keys = Object.keys(requireCondition);
			const typesIndex = keys.indexOf("types");
			const defaultIndex = keys.indexOf("default");
			expect(typesIndex).toBeLessThan(defaultIndex);
		});
	});

	// ─── ESM output format verification ──────────────────────────────────────

	describe("output format", () => {
		test("ESM build uses import/export syntax", async () => {
			const content = await Bun.file(DIST_ESM).text();
			expect(content).toContain("export");
			expect(content).not.toContain("require(");
			expect(content).not.toContain("__esModule");
		});

		test("CJS build uses require/exports syntax", async () => {
			const content = await Bun.file(DIST_CJS).text();
			expect(content).toContain("require(");
			expect(content).toContain("exports");
		});
	});
});
