import type { TemplateDiagnostic } from "./types.ts";

// ─── Base Class ──────────────────────────────────────────────────────────────
// All template engine errors extend this class, enabling targeted catch blocks:
// `catch (e) { if (e instanceof TemplateError) … }`
// Subclasses:
// - `TemplateParseError`        — invalid template syntax
// - `TemplateAnalysisError`     — static analysis failures (diagnostics)
// - `TemplateRuntimeError`      — execution failures
// - `UnsupportedSchemaError`    — schema uses unsupported JSON Schema features

export class TemplateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TemplateError";
	}

	/**
	 * Serializes the error into a JSON-compatible object, suitable for sending
	 * to a frontend or a structured logging system.
	 */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
		};
	}
}

// ─── Parse Error ─────────────────────────────────────────────────────────────
// Thrown when Handlebars fails to parse the template (invalid syntax).

export class TemplateParseError extends TemplateError {
	constructor(
		message: string,
		/** Approximate position of the error in the source */
		public readonly loc?: { line: number; column: number },
		/** Fragment of the template source around the error */
		public readonly source?: string,
	) {
		super(`Parse error: ${message}`);
		this.name = "TemplateParseError";
	}

	override toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			loc: this.loc,
			source: this.source,
		};
	}
}

// ─── Static Analysis Error ───────────────────────────────────────────────────
// Thrown in strict mode when the analysis produces at least one error.
// Contains the full list of diagnostics for detailed inspection.

export class TemplateAnalysisError extends TemplateError {
	/** Full list of diagnostics (errors + warnings) */
	public readonly diagnostics: TemplateDiagnostic[];

	/** Only diagnostics with "error" severity */
	public readonly errors: TemplateDiagnostic[];

	/** Only diagnostics with "warning" severity */
	public readonly warnings: TemplateDiagnostic[];

	/** Total number of errors */
	public readonly errorCount: number;

	/** Total number of warnings */
	public readonly warningCount: number;

	constructor(diagnostics: TemplateDiagnostic[]) {
		const errors = diagnostics.filter((d) => d.severity === "error");
		const warnings = diagnostics.filter((d) => d.severity === "warning");

		const summary = errors.map((d) => formatDiagnosticLine(d)).join("\n");
		super(`Static analysis failed with ${errors.length} error(s):\n${summary}`);

		this.name = "TemplateAnalysisError";
		this.diagnostics = diagnostics;
		this.errors = errors;
		this.warnings = warnings;
		this.errorCount = errors.length;
		this.warningCount = warnings.length;
	}

	/**
	 * Serializes the analysis error into a JSON-compatible object.
	 *
	 * Designed for direct use in API responses:
	 * ```
	 * res.status(400).json(error.toJSON());
	 * ```
	 *
	 * Returned structure:
	 * ```
	 * {
	 *   name: "TemplateAnalysisError",
	 *   message: "Static analysis failed with 2 error(s): ...",
	 *   errorCount: 2,
	 *   warningCount: 0,
	 *   diagnostics: [
	 *     {
	 *       severity: "error",
	 *       code: "UNKNOWN_PROPERTY",
	 *       message: "Property \"foo\" does not exist...",
	 *       loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 7 } },
	 *       source: "{{foo}}",
	 *       details: { path: "foo", availableProperties: ["name", "age"] }
	 *     }
	 *   ]
	 * }
	 * ```
	 */
	override toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			errorCount: this.errorCount,
			warningCount: this.warningCount,
			diagnostics: this.diagnostics,
		};
	}
}

// ─── Runtime Error ───────────────────────────────────────────────────────────
// Thrown when template execution fails (accessing a non-existent property
// in strict mode, unexpected type, etc.).

export class TemplateRuntimeError extends TemplateError {
	constructor(message: string) {
		super(`Runtime error: ${message}`);
		this.name = "TemplateRuntimeError";
	}
}

// ─── Unsupported Schema Error ────────────────────────────────────────────────
// Thrown when the provided JSON Schema uses features that cannot be handled
// by static analysis (e.g. `if/then/else` conditional schemas).
//
// These features are data-dependent and fundamentally non-resolvable without
// runtime values. Rather than silently ignoring them (which would produce
// incorrect analysis results), we fail fast with a clear error message.

export class UnsupportedSchemaError extends TemplateError {
	constructor(
		/** The unsupported keyword(s) detected (e.g. `"if/then/else"`) */
		public readonly keyword: string,
		/** JSON pointer path to the location in the schema (e.g. `"/properties/user"`) */
		public readonly schemaPath: string,
	) {
		super(
			`Unsupported JSON Schema feature: "${keyword}" at "${schemaPath}". ` +
				"Conditional schemas (if/then/else) cannot be resolved during static analysis " +
				"because they depend on runtime data. Consider using oneOf/anyOf combinators instead.",
		);
		this.name = "UnsupportedSchemaError";
	}

	override toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			keyword: this.keyword,
			schemaPath: this.schemaPath,
		};
	}
}

// ─── Internal Utilities ──────────────────────────────────────────────────────

/**
 * Formats a single diagnostic line for the summary message
 * of a `TemplateAnalysisError`.
 *
 * Produces a human-readable format:
 *   `  • [UNKNOWN_PROPERTY] Property "foo" does not exist (at 1:0)`
 */
function formatDiagnosticLine(diag: TemplateDiagnostic): string {
	const parts: string[] = [`  • [${diag.code}] ${diag.message}`];

	if (diag.loc) {
		parts.push(`(at ${diag.loc.start.line}:${diag.loc.start.column})`);
	}

	return parts.join(" ");
}

// ─── Common Error Factories ──────────────────────────────────────────────────
// These functions simplify the creation of typed errors across the codebase.

/**
 * Creates a structured diagnostic message for a missing property.
 * Used by the analyzer to produce enriched error messages with suggestions.
 */
export function createPropertyNotFoundMessage(
	path: string,
	availableProperties: string[],
): string {
	const base = `Property "${path}" does not exist in the context schema`;
	if (availableProperties.length === 0) return base;
	return `${base}. Available properties: ${availableProperties.join(", ")}`;
}

/**
 * Creates a message for a type mismatch on a block helper.
 */
export function createTypeMismatchMessage(
	helperName: string,
	expected: string,
	actual: string,
): string {
	return `"{{#${helperName}}}" expects ${expected}, but resolved schema has type "${actual}"`;
}

/**
 * Creates a message for a missing argument on a block helper.
 */
export function createMissingArgumentMessage(helperName: string): string {
	return `"{{#${helperName}}}" requires an argument`;
}

/**
 * Creates a message for an unknown block helper.
 */
export function createUnknownHelperMessage(helperName: string): string {
	return `Unknown block helper "{{#${helperName}}}" — cannot analyze statically`;
}

/**
 * Creates a message for an expression that cannot be statically analyzed.
 */
export function createUnanalyzableMessage(nodeType: string): string {
	return `Expression of type "${nodeType}" cannot be statically analyzed`;
}
