import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// ─── Postbuild Script ────────────────────────────────────────────────────────
// 1. Rewrites `.ts` extensions → `.js` in all compiled `.js` and `.d.ts` files
//    under `dist/` (SWC and tsc preserve the original `.ts` import specifiers
//    when the source uses `allowImportingTsExtensions`).
// 2. Adds `.js` extension to relative imports that have no extension at all
//    (needed for Node.js ESM which requires explicit file extensions).
// 3. Creates `dist/cjs/package.json` with `{ "type": "commonjs" }` so Node.js
//    treats `.js` files in that directory as CommonJS modules.

const ROOT = resolve(import.meta.dir, "..");
const DIST = resolve(ROOT, "dist");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively collect all files matching the given extensions under `dir`.
 */
async function collectFiles(
	dir: string,
	extensions: string[],
): Promise<string[]> {
	const results: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await collectFiles(fullPath, extensions)));
		} else if (extensions.some((ext) => entry.name.endsWith(ext))) {
			results.push(fullPath);
		}
	}

	return results;
}

/**
 * Check whether a relative import specifier already has a known JS/TS
 * file extension.
 */
function hasKnownExtension(specifier: string): boolean {
	return /\.(js|mjs|cjs|ts|mts|cts|json)$/.test(specifier);
}

/**
 * Determine whether a relative specifier (without extension) refers to a
 * file (`<specifier>.js`) or a directory with an index (`<specifier>/index.js`).
 * Returns the correct specifier with `.js` appended, or the original if
 * no match is found on disk.
 */
function resolveExtensionless(specifier: string, fromFile: string): string {
	const dir = dirname(fromFile);
	const abs = resolve(dir, specifier);

	// Check <specifier>.js
	if (existsSync(`${abs}.js`)) {
		return `${specifier}.js`;
	}

	// Check <specifier>/index.js (directory import)
	if (existsSync(join(abs, "index.js"))) {
		return `${specifier}/index.js`;
	}

	// Fallback: just append .js (the file may not exist yet during parallel builds)
	return `${specifier}.js`;
}

/**
 * Rewrite import/require specifiers in the given file content:
 *   1. `.ts` → `.js`
 *   2. extensionless relative imports → add `.js`
 *
 * Handles patterns like:
 *   - from "./foo.ts"       → from "./foo.js"
 *   - from './foo.ts'       → from './foo.js'
 *   - from"./foo"           → from"./foo.js"        (minified)
 *   - require("./foo.ts")   → require("./foo.js")
 *   - require("./foo")      → require("./foo.js")
 */
function rewriteSpecifiers(content: string, filePath: string): string {
	// Unified regex that captures:
	//   group 1: the keyword + opening quote  (e.g. `from"` or `require("`)
	//   group 2: the specifier                (e.g. `./foo.ts` or `./foo`)
	//   group 3: the closing quote            (e.g. `"` or `'`)
	return content.replace(
		/((?:from\s*|require\s*\()["'])([^"'\n]+)(["'])/g,
		(_match, prefix: string, specifier: string, suffix: string) => {
			// Only touch relative specifiers (starting with ./ or ../)
			if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
				return `${prefix}${specifier}${suffix}`;
			}

			// 1. Rewrite .ts → .js
			if (specifier.endsWith(".ts")) {
				return `${prefix}${specifier.slice(0, -3)}.js${suffix}`;
			}

			// 2. Add .js to extensionless relative imports
			if (!hasKnownExtension(specifier)) {
				const resolved = resolveExtensionless(specifier, filePath);
				return `${prefix}${resolved}${suffix}`;
			}

			return `${prefix}${specifier}${suffix}`;
		},
	);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	// 1. Rewrite specifiers in all JS and declaration files
	const files = await collectFiles(DIST, [".js", ".d.ts"]);

	let rewrittenCount = 0;

	await Promise.all(
		files.map(async (filePath) => {
			const original = await readFile(filePath, "utf-8");
			const rewritten = rewriteSpecifiers(original, filePath);

			if (rewritten !== original) {
				await writeFile(filePath, rewritten, "utf-8");
				rewrittenCount++;
			}
		}),
	);

	console.log(`✓ Rewrote import specifiers in ${rewrittenCount} file(s)`);

	// 2. Create dist/cjs/package.json for CommonJS resolution
	const cjsPkgPath = resolve(DIST, "cjs", "package.json");
	await writeFile(
		cjsPkgPath,
		`${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
		"utf-8",
	);

	console.log("✓ Created dist/cjs/package.json with { type: commonjs }");
}

main().catch((err) => {
	console.error("Postbuild failed:", err);
	process.exit(1);
});
