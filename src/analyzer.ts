import type { JSONSchema7 } from "json-schema";
import {
	createMissingArgumentMessage,
	createPropertyNotFoundMessage,
	createTypeMismatchMessage,
	createUnanalyzableMessage,
	createUnknownHelperMessage,
} from "./errors.ts";
import {
	detectLiteralType,
	extractExpressionIdentifier,
	extractPathSegments,
	getEffectiveBody,
	getEffectivelySingleBlock,
	getEffectivelySingleExpression,
	isThisExpression,
	parse,
} from "./parser.ts";
import {
	resolveArrayItems,
	resolveSchemaPath,
	simplifySchema,
} from "./schema-resolver.ts";
import type {
	AnalysisResult,
	DiagnosticCode,
	DiagnosticDetails,
	HelperDefinition,
	TemplateDiagnostic,
	TemplateInput,
	TemplateInputObject,
} from "./types.ts";
import {
	inferPrimitiveSchema,
	isLiteralInput,
	isObjectInput,
} from "./types.ts";
import {
	aggregateObjectAnalysis,
	deepEqual,
	extractSourceSnippet,
	getSchemaPropertyNames,
} from "./utils.ts";

// ─── Static Analyzer ─────────────────────────────────────────────────────────
// Static analysis of a Handlebars template against a JSON Schema v7
// describing the available context.
//
// Merged architecture (v2):
// A single AST traversal performs both **validation** and **return type
// inference** simultaneously. This eliminates duplication between the former
// `validate*` and `infer*` functions and improves performance by avoiding
// a double traversal.
//
// Context:
// The analysis context uses a **save/restore** pattern instead of creating
// new objects on each recursion (`{ ...ctx, current: X }`). This reduces
// GC pressure for deeply nested templates.
//
// ─── Template Identifiers ────────────────────────────────────────────────────
// The `{{key:N}}` syntax allows referencing a variable from a specific
// schema, identified by an integer N. The optional `identifierSchemas`
// parameter provides a mapping `{ [id]: JSONSchema7 }`.
//
// Resolution rules:
// - `{{meetingId}}`   → validated against `inputSchema` (standard behavior)
// - `{{meetingId:1}}` → validated against `identifierSchemas[1]`
// - `{{meetingId:1}}` without `identifierSchemas[1]` → error

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Context passed recursively during AST traversal */
interface AnalysisContext {
	/** Root schema (for resolving $refs) */
	root: JSONSchema7;
	/** Current context schema (changes with #each, #with) — mutated via save/restore */
	current: JSONSchema7;
	/** Diagnostics accumulator */
	diagnostics: TemplateDiagnostic[];
	/** Full template source (for extracting error snippets) */
	template: string;
	/** Schemas by template identifier (for the {{key:N}} syntax) */
	identifierSchemas?: Record<number, JSONSchema7>;
	/** Registered custom helpers (for static analysis) */
	helpers?: Map<string, HelperDefinition>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Statically analyzes a template against a JSON Schema v7 describing the
 * available context.
 *
 * Backward-compatible version — parses the template internally.
 *
 * @param template           - The template string (e.g. `"Hello {{user.name}}"`)
 * @param inputSchema        - JSON Schema v7 describing the available variables
 * @param identifierSchemas  - (optional) Schemas by identifier `{ [id]: JSONSchema7 }`
 * @returns An `AnalysisResult` containing validity, diagnostics, and the
 *          inferred output schema.
 */
export function analyze(
	template: TemplateInput,
	inputSchema: JSONSchema7,
	identifierSchemas?: Record<number, JSONSchema7>,
): AnalysisResult {
	if (isObjectInput(template)) {
		return analyzeObjectTemplate(template, inputSchema, identifierSchemas);
	}
	if (isLiteralInput(template)) {
		return {
			valid: true,
			diagnostics: [],
			outputSchema: inferPrimitiveSchema(template),
		};
	}
	const ast = parse(template);
	return analyzeFromAst(ast, template, inputSchema, { identifierSchemas });
}

/**
 * Analyzes an object template recursively (standalone version).
 * Each property is analyzed individually, diagnostics are merged,
 * and the `outputSchema` reflects the object structure.
 */
function analyzeObjectTemplate(
	template: TemplateInputObject,
	inputSchema: JSONSchema7,
	identifierSchemas?: Record<number, JSONSchema7>,
): AnalysisResult {
	return aggregateObjectAnalysis(Object.keys(template), (key) =>
		analyze(template[key] as TemplateInput, inputSchema, identifierSchemas),
	);
}

/**
 * Statically analyzes a template from an already-parsed AST.
 *
 * This is the internal function used by `Typebars.compile()` and
 * `CompiledTemplate.analyze()` to avoid costly re-parsing.
 *
 * @param ast               - The already-parsed Handlebars AST
 * @param template          - The template source (for error snippets)
 * @param inputSchema       - JSON Schema v7 describing the available variables
 * @param options           - Additional options
 * @returns An `AnalysisResult`
 */
export function analyzeFromAst(
	ast: hbs.AST.Program,
	template: string,
	inputSchema: JSONSchema7,
	options?: {
		identifierSchemas?: Record<number, JSONSchema7>;
		helpers?: Map<string, HelperDefinition>;
	},
): AnalysisResult {
	const ctx: AnalysisContext = {
		root: inputSchema,
		current: inputSchema,
		diagnostics: [],
		template,
		identifierSchemas: options?.identifierSchemas,
		helpers: options?.helpers,
	};

	// Single pass: type inference + validation in one traversal.
	const outputSchema = inferProgramType(ast, ctx);

	const hasErrors = ctx.diagnostics.some((d) => d.severity === "error");

	return {
		valid: !hasErrors,
		diagnostics: ctx.diagnostics,
		outputSchema: simplifySchema(outputSchema),
	};
}

// ─── Unified AST Traversal ───────────────────────────────────────────────────
// A single set of functions handles both validation (emitting diagnostics)
// and type inference (returning a JSONSchema7).
//
// Main functions:
// - `inferProgramType`   — entry point for a Program (template body or block)
// - `processStatement`   — dispatches a statement (validation side-effects)
// - `processMustache`    — handles a MustacheStatement (expression or inline helper)
// - `inferBlockType`     — handles a BlockStatement (if, each, with, custom…)

/**
 * Dispatches the processing of an individual statement.
 *
 * Called by `inferProgramType` in the "mixed template" case to validate
 * each statement while ignoring the returned type (the result is always
 * `string` for a mixed template).
 *
 * @returns The inferred schema for this statement, or `undefined` for
 *          statements with no semantics (ContentStatement, CommentStatement).
 */
function processStatement(
	stmt: hbs.AST.Statement,
	ctx: AnalysisContext,
): JSONSchema7 | undefined {
	switch (stmt.type) {
		case "ContentStatement":
		case "CommentStatement":
			// Static text or comment — nothing to validate, no type to infer
			return undefined;

		case "MustacheStatement":
			return processMustache(stmt as hbs.AST.MustacheStatement, ctx);

		case "BlockStatement":
			return inferBlockType(stmt as hbs.AST.BlockStatement, ctx);

		default:
			// Unrecognized AST node — emit a warning rather than an error
			// to avoid blocking on future Handlebars extensions.
			addDiagnostic(
				ctx,
				"UNANALYZABLE",
				"warning",
				`Unsupported AST node type: "${stmt.type}"`,
				stmt,
			);
			return undefined;
	}
}

/**
 * Processes a MustacheStatement `{{expression}}` or `{{helper arg}}`.
 *
 * Distinguishes two cases:
 * 1. **Simple expression** (`{{name}}`, `{{user.age}}`) — resolution in the schema
 * 2. **Inline helper** (`{{uppercase name}}`) — params > 0 or hash present
 *
 * @returns The inferred schema for this expression
 */
function processMustache(
	stmt: hbs.AST.MustacheStatement,
	ctx: AnalysisContext,
): JSONSchema7 {
	// Sub-expressions (nested helpers) are not supported for static
	// analysis — emit a warning.
	if (stmt.path.type === "SubExpression") {
		addDiagnostic(
			ctx,
			"UNANALYZABLE",
			"warning",
			"Sub-expressions are not statically analyzable",
			stmt,
		);
		return {};
	}

	// ── Inline helper detection ──────────────────────────────────────────────
	// If the MustacheStatement has parameters or a hash, it's a helper call
	// (e.g. `{{uppercase name}}`), not a simple expression.
	if (stmt.params.length > 0 || stmt.hash) {
		const helperName = getExpressionName(stmt.path);

		// Check if the helper is registered
		const helper = ctx.helpers?.get(helperName);
		if (helper) {
			const helperParams = helper.params;

			// ── Check the number of required parameters ──────────────
			if (helperParams) {
				const requiredCount = helperParams.filter((p) => !p.optional).length;
				if (stmt.params.length < requiredCount) {
					addDiagnostic(
						ctx,
						"MISSING_ARGUMENT",
						"error",
						`Helper "${helperName}" expects at least ${requiredCount} argument(s), but got ${stmt.params.length}`,
						stmt,
						{
							helperName,
							expected: `${requiredCount} argument(s)`,
							actual: `${stmt.params.length} argument(s)`,
						},
					);
				}
			}

			// ── Validate each parameter (existence + type) ───────────────
			for (let i = 0; i < stmt.params.length; i++) {
				const resolvedSchema = resolveExpressionWithDiagnostics(
					stmt.params[i] as hbs.AST.Expression,
					ctx,
					stmt,
				);

				// Check type compatibility if the helper declares the
				// expected type for this parameter
				const helperParam = helperParams?.[i];
				if (resolvedSchema && helperParam?.type) {
					const expectedType = helperParam.type;
					if (!isParamTypeCompatible(resolvedSchema, expectedType)) {
						const paramName = helperParam.name;
						addDiagnostic(
							ctx,
							"TYPE_MISMATCH",
							"error",
							`Helper "${helperName}" parameter "${paramName}" expects ${schemaTypeLabel(expectedType)}, but got ${schemaTypeLabel(resolvedSchema)}`,
							stmt,
							{
								helperName,
								expected: schemaTypeLabel(expectedType),
								actual: schemaTypeLabel(resolvedSchema),
							},
						);
					}
				}
			}

			return helper.returnType ?? { type: "string" };
		}

		// Unknown inline helper — warning
		addDiagnostic(
			ctx,
			"UNKNOWN_HELPER",
			"warning",
			`Unknown inline helper "${helperName}" — cannot analyze statically`,
			stmt,
			{ helperName },
		);
		return { type: "string" };
	}

	// ── Simple expression ────────────────────────────────────────────────────
	return resolveExpressionWithDiagnostics(stmt.path, ctx, stmt) ?? {};
}

/**
 * Checks whether a resolved type is compatible with the type expected
 * by a helper parameter.
 *
 * Compatibility rules:
 * - If either schema has no `type`, validation is not possible → compatible
 * - `integer` is compatible with `number` (integer ⊂ number)
 * - For multiple types (e.g. `["string", "number"]`), at least one resolved
 *   type must match one expected type
 */
function isParamTypeCompatible(
	resolved: JSONSchema7,
	expected: JSONSchema7,
): boolean {
	// If either has no type info, we cannot validate
	if (!expected.type || !resolved.type) return true;

	const expectedTypes = Array.isArray(expected.type)
		? expected.type
		: [expected.type];
	const resolvedTypes = Array.isArray(resolved.type)
		? resolved.type
		: [resolved.type];

	// At least one resolved type must be compatible with one expected type
	return resolvedTypes.some((rt) =>
		expectedTypes.some(
			(et) =>
				rt === et ||
				// integer is a subtype of number
				(et === "number" && rt === "integer") ||
				(et === "integer" && rt === "number"),
		),
	);
}

/**
 * Infers the output type of a `Program` (template body or block body).
 *
 * Handles 4 cases, from most specific to most general:
 *
 * 1. **Single expression** `{{expr}}` → type of the expression
 * 2. **Single block** `{{#if}}…{{/if}}` → type of the block
 * 3. **Pure text content** → literal detection (number, boolean, null)
 * 4. **Mixed template** → always `string` (concatenation)
 *
 * Validation is performed alongside inference: each expression and block
 * is validated during processing.
 */
function inferProgramType(
	program: hbs.AST.Program,
	ctx: AnalysisContext,
): JSONSchema7 {
	const effective = getEffectiveBody(program);

	// No significant statements → empty string
	if (effective.length === 0) {
		return { type: "string" };
	}

	// ── Case 1: single expression {{expr}} ─────────────────────────────────
	const singleExpr = getEffectivelySingleExpression(program);
	if (singleExpr) {
		return processMustache(singleExpr, ctx);
	}

	// ── Case 2: single block {{#if}}, {{#each}}, {{#with}}, … ──────────────
	const singleBlock = getEffectivelySingleBlock(program);
	if (singleBlock) {
		return inferBlockType(singleBlock, ctx);
	}

	// ── Case 3: only ContentStatements (no expressions) ────────────────────
	// If the concatenated (trimmed) text is a typed literal (number, boolean,
	// null), we infer the corresponding type.
	const allContent = effective.every((s) => s.type === "ContentStatement");
	if (allContent) {
		const text = effective
			.map((s) => (s as hbs.AST.ContentStatement).value)
			.join("")
			.trim();

		if (text === "") return { type: "string" };

		const literalType = detectLiteralType(text);
		if (literalType) return { type: literalType };
	}

	// ── Case 4: mixed template (text + expressions, multiple blocks…) ──────
	// Traverse all statements for validation (side-effects: diagnostics).
	// The result is always string (concatenation).
	for (const stmt of program.body) {
		processStatement(stmt, ctx);
	}
	return { type: "string" };
}

/**
 * Infers the output type of a BlockStatement and validates its content.
 *
 * Supports built-in helpers (`if`, `unless`, `each`, `with`) and custom
 * helpers registered via `Typebars.registerHelper()`.
 *
 * Uses the **save/restore** pattern for context: instead of creating a new
 * object `{ ...ctx, current: X }` on each recursion, we save `ctx.current`,
 * mutate it, process the body, then restore. This reduces GC pressure for
 * deeply nested templates.
 */
function inferBlockType(
	stmt: hbs.AST.BlockStatement,
	ctx: AnalysisContext,
): JSONSchema7 {
	const helperName = getBlockHelperName(stmt);

	switch (helperName) {
		// ── if / unless ──────────────────────────────────────────────────────
		// Validate the condition argument, then infer types from both branches.
		case "if":
		case "unless": {
			const arg = getBlockArgument(stmt);
			if (arg) {
				resolveExpressionWithDiagnostics(arg, ctx, stmt);
			} else {
				addDiagnostic(
					ctx,
					"MISSING_ARGUMENT",
					"error",
					createMissingArgumentMessage(helperName),
					stmt,
					{ helperName },
				);
			}

			// Infer the type of the "then" branch
			const thenType = inferProgramType(stmt.program, ctx);

			if (stmt.inverse) {
				const elseType = inferProgramType(stmt.inverse, ctx);
				// If both branches have the same type → single type
				if (deepEqual(thenType, elseType)) return thenType;
				// Otherwise → union of both types
				return simplifySchema({ oneOf: [thenType, elseType] });
			}

			// No else branch → the result is the type of the then branch
			// (conceptually optional, but Handlebars returns "" for falsy)
			return thenType;
		}

		// ── each ─────────────────────────────────────────────────────────────
		// Resolve the collection schema, then validate the body with the item
		// schema as the new context.
		case "each": {
			const arg = getBlockArgument(stmt);
			if (!arg) {
				addDiagnostic(
					ctx,
					"MISSING_ARGUMENT",
					"error",
					createMissingArgumentMessage("each"),
					stmt,
					{ helperName: "each" },
				);
				// Validate the body with an empty context (best-effort)
				const saved = ctx.current;
				ctx.current = {};
				inferProgramType(stmt.program, ctx);
				ctx.current = saved;
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return { type: "string" };
			}

			const collectionSchema = resolveExpressionWithDiagnostics(arg, ctx, stmt);
			if (!collectionSchema) {
				// The path could not be resolved — diagnostic already emitted.
				const saved = ctx.current;
				ctx.current = {};
				inferProgramType(stmt.program, ctx);
				ctx.current = saved;
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return { type: "string" };
			}

			// Resolve the schema of the array elements
			const itemSchema = resolveArrayItems(collectionSchema, ctx.root);
			if (!itemSchema) {
				addDiagnostic(
					ctx,
					"TYPE_MISMATCH",
					"error",
					createTypeMismatchMessage(
						"each",
						"an array",
						schemaTypeLabel(collectionSchema),
					),
					stmt,
					{
						helperName: "each",
						expected: "array",
						actual: schemaTypeLabel(collectionSchema),
					},
				);
				// Validate the body with an empty context (best-effort)
				const saved = ctx.current;
				ctx.current = {};
				inferProgramType(stmt.program, ctx);
				ctx.current = saved;
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return { type: "string" };
			}

			// Validate the body with the item schema as the new context
			const saved = ctx.current;
			ctx.current = itemSchema;
			inferProgramType(stmt.program, ctx);
			ctx.current = saved;

			// The inverse branch ({{else}}) keeps the parent context
			if (stmt.inverse) inferProgramType(stmt.inverse, ctx);

			// An each concatenates renders → always string
			return { type: "string" };
		}

		// ── with ─────────────────────────────────────────────────────────────
		// Resolve the inner schema, then validate the body with it as the
		// new context.
		case "with": {
			const arg = getBlockArgument(stmt);
			if (!arg) {
				addDiagnostic(
					ctx,
					"MISSING_ARGUMENT",
					"error",
					createMissingArgumentMessage("with"),
					stmt,
					{ helperName: "with" },
				);
				// Validate the body with an empty context
				const saved = ctx.current;
				ctx.current = {};
				const result = inferProgramType(stmt.program, ctx);
				ctx.current = saved;
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return result;
			}

			const innerSchema = resolveExpressionWithDiagnostics(arg, ctx, stmt);

			const saved = ctx.current;
			ctx.current = innerSchema ?? {};
			const result = inferProgramType(stmt.program, ctx);
			ctx.current = saved;

			// The inverse branch keeps the parent context
			if (stmt.inverse) inferProgramType(stmt.inverse, ctx);

			return result;
		}

		// ── Custom or unknown helper ─────────────────────────────────────────
		default: {
			const helper = ctx.helpers?.get(helperName);
			if (helper) {
				// Registered custom helper — validate parameters
				for (const param of stmt.params) {
					resolveExpressionWithDiagnostics(
						param as hbs.AST.Expression,
						ctx,
						stmt,
					);
				}
				// Validate the body with the current context
				inferProgramType(stmt.program, ctx);
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return helper.returnType ?? { type: "string" };
			}

			// Unknown helper — warning
			addDiagnostic(
				ctx,
				"UNKNOWN_HELPER",
				"warning",
				createUnknownHelperMessage(helperName),
				stmt,
				{ helperName },
			);
			// Still validate the body with the current context (best-effort)
			inferProgramType(stmt.program, ctx);
			if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
			return { type: "string" };
		}
	}
}

// ─── Expression Resolution ───────────────────────────────────────────────────

/**
 * Resolves an AST expression to a sub-schema, emitting a diagnostic
 * if the path cannot be resolved.
 *
 * Handles the `{{key:N}}` syntax:
 * - If the expression has an identifier N → resolution in `identifierSchemas[N]`
 * - If identifier N has no associated schema → error
 * - If no identifier → resolution in `ctx.current` (standard behavior)
 *
 * @returns The resolved sub-schema, or `undefined` if the path is invalid.
 */
function resolveExpressionWithDiagnostics(
	expr: hbs.AST.Expression,
	ctx: AnalysisContext,
	/** Parent AST node (for diagnostic location) */
	parentNode?: hbs.AST.Node,
): JSONSchema7 | undefined {
	// Handle `this` / `.` → return the current context
	if (isThisExpression(expr)) {
		return ctx.current;
	}

	const segments = extractPathSegments(expr);
	if (segments.length === 0) {
		// Expression that is not a PathExpression (e.g. literal, SubExpression)
		if (expr.type === "StringLiteral") return { type: "string" };
		if (expr.type === "NumberLiteral") return { type: "number" };
		if (expr.type === "BooleanLiteral") return { type: "boolean" };
		if (expr.type === "NullLiteral") return { type: "null" };
		if (expr.type === "UndefinedLiteral") return {};

		addDiagnostic(
			ctx,
			"UNANALYZABLE",
			"warning",
			createUnanalyzableMessage(expr.type),
			parentNode ?? expr,
		);
		return undefined;
	}

	// ── Identifier extraction ──────────────────────────────────────────────
	const { cleanSegments, identifier } = extractExpressionIdentifier(segments);

	if (identifier !== null) {
		// The expression uses the {{key:N}} syntax — resolve from
		// the schema of identifier N.
		return resolveWithIdentifier(
			cleanSegments,
			identifier,
			ctx,
			parentNode ?? expr,
		);
	}

	// ── Standard resolution (no identifier) ────────────────────────────────
	const resolved = resolveSchemaPath(ctx.current, cleanSegments);
	if (resolved === undefined) {
		const fullPath = cleanSegments.join(".");
		const availableProperties = getSchemaPropertyNames(ctx.current);
		addDiagnostic(
			ctx,
			"UNKNOWN_PROPERTY",
			"error",
			createPropertyNotFoundMessage(fullPath, availableProperties),
			parentNode ?? expr,
			{ path: fullPath, availableProperties },
		);
		return undefined;
	}

	return resolved;
}

/**
 * Resolves an expression with identifier `{{key:N}}` by looking up the
 * schema associated with identifier N.
 *
 * Emits an error diagnostic if:
 * - No `identifierSchemas` were provided
 * - Identifier N has no associated schema
 * - The property does not exist in the identifier's schema
 */
function resolveWithIdentifier(
	cleanSegments: string[],
	identifier: number,
	ctx: AnalysisContext,
	node: hbs.AST.Node,
): JSONSchema7 | undefined {
	const fullPath = cleanSegments.join(".");

	// No identifierSchemas provided at all
	if (!ctx.identifierSchemas) {
		addDiagnostic(
			ctx,
			"MISSING_IDENTIFIER_SCHEMAS",
			"error",
			`Property "${fullPath}:${identifier}" uses an identifier but no identifier schemas were provided`,
			node,
			{ path: `${fullPath}:${identifier}`, identifier },
		);
		return undefined;
	}

	// The identifier does not exist in the provided schemas
	const idSchema = ctx.identifierSchemas[identifier];
	if (!idSchema) {
		addDiagnostic(
			ctx,
			"UNKNOWN_IDENTIFIER",
			"error",
			`Property "${fullPath}:${identifier}" references identifier ${identifier} but no schema exists for this identifier`,
			node,
			{ path: `${fullPath}:${identifier}`, identifier },
		);
		return undefined;
	}

	// Resolve the path within the identifier's schema
	const resolved = resolveSchemaPath(idSchema, cleanSegments);
	if (resolved === undefined) {
		const availableProperties = getSchemaPropertyNames(idSchema);
		addDiagnostic(
			ctx,
			"IDENTIFIER_PROPERTY_NOT_FOUND",
			"error",
			`Property "${fullPath}" does not exist in the schema for identifier ${identifier}`,
			node,
			{
				path: fullPath,
				identifier,
				availableProperties,
			},
		);
		return undefined;
	}

	return resolved;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Extracts the first argument of a BlockStatement.
 *
 * In the Handlebars AST, for `{{#if active}}`:
 * - `stmt.path` → PathExpression("if")    ← the helper name
 * - `stmt.params[0]` → PathExpression("active") ← the actual argument
 *
 * @returns The argument expression, or `undefined` if the block has no argument.
 */
function getBlockArgument(
	stmt: hbs.AST.BlockStatement,
): hbs.AST.Expression | undefined {
	return stmt.params[0] as hbs.AST.Expression | undefined;
}

/**
 * Retrieves the helper name from a BlockStatement (e.g. "if", "each", "with").
 */
function getBlockHelperName(stmt: hbs.AST.BlockStatement): string {
	if (stmt.path.type === "PathExpression") {
		return (stmt.path as hbs.AST.PathExpression).original;
	}
	return "";
}

/**
 * Retrieves the name of an expression (first segment of the PathExpression).
 * Used to identify inline helpers.
 */
function getExpressionName(expr: hbs.AST.Expression): string {
	if (expr.type === "PathExpression") {
		return (expr as hbs.AST.PathExpression).original;
	}
	return "";
}

/**
 * Adds an enriched diagnostic to the analysis context.
 *
 * Each diagnostic includes:
 * - A machine-readable `code` for the frontend
 * - A human-readable `message` describing the problem
 * - A `source` snippet from the template (if the position is available)
 * - Structured `details` for debugging
 */
function addDiagnostic(
	ctx: AnalysisContext,
	code: DiagnosticCode,
	severity: "error" | "warning",
	message: string,
	node?: hbs.AST.Node,
	details?: DiagnosticDetails,
): void {
	const diagnostic: TemplateDiagnostic = { severity, code, message };

	// Extract the position and source snippet if available
	if (node && "loc" in node && node.loc) {
		diagnostic.loc = {
			start: { line: node.loc.start.line, column: node.loc.start.column },
			end: { line: node.loc.end.line, column: node.loc.end.column },
		};
		// Extract the template fragment around the error
		diagnostic.source = extractSourceSnippet(ctx.template, diagnostic.loc);
	}

	if (details) {
		diagnostic.details = details;
	}

	ctx.diagnostics.push(diagnostic);
}

/**
 * Returns a human-readable label for a schema's type (for error messages).
 */
function schemaTypeLabel(schema: JSONSchema7): string {
	if (schema.type) {
		return Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
	}
	if (schema.oneOf) return "oneOf(...)";
	if (schema.anyOf) return "anyOf(...)";
	if (schema.allOf) return "allOf(...)";
	if (schema.enum) return "enum";
	return "unknown";
}

// ─── Export for Internal Use ─────────────────────────────────────────────────
// `inferBlockType` is exported to allow targeted unit tests
// on block type inference.
export { inferBlockType };
