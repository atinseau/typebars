import type { JSONSchema7 } from "json-schema";
import { dispatchAnalyze } from "./dispatch.ts";
import {
	createMissingArgumentMessage,
	createPropertyNotFoundMessage,
	createRootPathTraversalMessage,
	createTypeMismatchMessage,
	createUnanalyzableMessage,
	createUnknownHelperMessage,
} from "./errors";
import { DefaultHelpers } from "./helpers/default-helpers.ts";
import { MapHelpers } from "./helpers/map-helpers.ts";
import {
	detectLiteralType,
	extractExpressionIdentifier,
	extractPathSegments,
	getEffectiveBody,
	getEffectivelySingleBlock,
	getEffectivelySingleExpression,
	isDataExpression,
	isRootPathTraversal,
	isRootSegments,
	isThisExpression,
	parse,
} from "./parser";
import {
	findConditionalSchemaLocations,
	isPropertyRequired,
	resolveArrayItems,
	resolveSchemaPath,
	simplifySchema,
} from "./schema-resolver";
import type {
	AnalysisResult,
	DiagnosticCode,
	DiagnosticDetails,
	HelperDefinition,
	TemplateDiagnostic,
	TemplateInput,
} from "./types.ts";
import {
	deepEqual,
	extractSourceSnippet,
	getSchemaPropertyNames,
} from "./utils";

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
	/**
	 * Explicit coercion schema provided by the caller.
	 * When set, static literal values like `"123"` will respect the type
	 * declared in this schema instead of being auto-detected by
	 * `detectLiteralType`. Unlike the previous `expectedOutputType`,
	 * this is NEVER derived from the inputSchema — it must be explicitly
	 * provided via the `coerceSchema` option.
	 */
	coerceSchema?: JSONSchema7;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Options for the standalone `analyze()` function */
export interface AnalyzeOptions {
	/** Schemas by template identifier (for the `{{key:N}}` syntax) */
	identifierSchemas?: Record<number, JSONSchema7>;
	/**
	 * Explicit coercion schema. When provided, static literal values
	 * will respect the types declared in this schema instead of being
	 * auto-detected by `detectLiteralType`.
	 *
	 * This schema is independent from the `inputSchema` (which describes
	 * available variables) — it only controls the output type inference
	 * for static content.
	 */
	coerceSchema?: JSONSchema7;
	/**
	 * When `true`, properties whose values contain Handlebars expressions
	 * (i.e. any `{{…}}` syntax) are excluded from the output schema.
	 *
	 * Only the properties with static values (literals, plain strings
	 * without expressions) are retained. This is useful when you want
	 * the output schema to describe only the known, compile-time-constant
	 * portion of the template.
	 *
	 * This option only has an effect on **object** and **array** templates.
	 * A root-level string template with expressions is analyzed normally
	 * (there is no parent property to exclude it from).
	 *
	 * @default false
	 */
	excludeTemplateExpression?: boolean;
}

// ─── Coerce Text Value ──────────────────────────────────────────────────────

/**
 * Parses a raw text string into the appropriate JS primitive according to the
 * target JSON Schema type.  Used when `coerceSchema` overrides the default
 * `detectLiteralType` inference for static literal values.
 */
function coerceTextValue(
	text: string,
	targetType: "string" | "number" | "integer" | "boolean" | "null",
): string | number | boolean | null | undefined {
	switch (targetType) {
		case "number":
		case "integer": {
			if (text === "") return undefined;
			const num = Number(text);
			if (Number.isNaN(num)) return undefined;
			if (targetType === "integer" && !Number.isInteger(num)) return undefined;
			return num;
		}
		case "boolean": {
			const lower = text.toLowerCase();
			if (lower === "true") return true;
			if (lower === "false") return false;
			return undefined;
		}
		case "null":
			return null;
		default:
			return text;
	}
}

/**
 * Statically analyzes a template against a JSON Schema v7 describing the
 * available context.
 *
 * Backward-compatible version — parses the template internally.
 * Uses `dispatchAnalyze` for the recursive array/object/literal dispatching,
 * delegating only the string (template) case to `analyzeFromAst`.
 *
 * @param template           - The template string (e.g. `"Hello {{user.name}}"`)
 * @param inputSchema        - JSON Schema v7 describing the available variables
 * @param options            - (optional) Analysis options (identifierSchemas, coerceSchema)
 * @returns An `AnalysisResult` containing validity, diagnostics, and the
 *          inferred output schema.
 */
export function analyze(
	template: TemplateInput,
	inputSchema: JSONSchema7 = {},
	options?: AnalyzeOptions,
): AnalysisResult {
	return dispatchAnalyze(
		template,
		options,
		// String handler — parse and analyze the AST
		(tpl, coerceSchema) => {
			const ast = parse(tpl);
			return analyzeFromAst(ast, tpl, inputSchema, {
				identifierSchemas: options?.identifierSchemas,
				coerceSchema,
			});
		},
		// Recursive handler — re-enter analyze() for child elements
		(child, childOptions) => analyze(child, inputSchema, childOptions),
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
	inputSchema: JSONSchema7 = {},
	options?: {
		identifierSchemas?: Record<number, JSONSchema7>;
		helpers?: Map<string, HelperDefinition>;
		/**
		 * Explicit coercion schema. When set, static literal values will
		 * respect the types declared in this schema instead of auto-detecting.
		 * Unlike `expectedOutputType`, this is NEVER derived from inputSchema.
		 */
		coerceSchema?: JSONSchema7;
	},
): AnalysisResult {
	// ── Initialize the diagnostic context FIRST ────────────────────────
	const ctx: AnalysisContext = {
		root: inputSchema,
		current: inputSchema,
		diagnostics: [],
		template,
		identifierSchemas: options?.identifierSchemas,
		helpers: options?.helpers,
		coerceSchema: options?.coerceSchema,
	};

	// ── Detect unsupported schema features as diagnostics ──────────────
	// Conditional schemas (if/then/else) are non-resolvable without runtime
	// data. Instead of throwing, we collect structured diagnostics so the
	// caller receives a standard AnalysisResult.
	const conditionalLocations = findConditionalSchemaLocations(inputSchema);
	for (const loc of conditionalLocations) {
		addDiagnostic(
			ctx,
			"UNSUPPORTED_SCHEMA",
			"error",
			`Unsupported JSON Schema feature: "${loc.keyword}" at "${loc.schemaPath}". ` +
				"Conditional schemas (if/then/else) cannot be resolved during static analysis " +
				"because they depend on runtime data. Consider using oneOf/anyOf combinators instead.",
			undefined,
			{ path: loc.schemaPath },
		);
	}

	if (options?.identifierSchemas) {
		for (const [id, idSchema] of Object.entries(options.identifierSchemas)) {
			const idLocations = findConditionalSchemaLocations(
				idSchema,
				`/identifierSchemas/${id}`,
			);
			for (const loc of idLocations) {
				addDiagnostic(
					ctx,
					"UNSUPPORTED_SCHEMA",
					"error",
					`Unsupported JSON Schema feature: "${loc.keyword}" at "${loc.schemaPath}". ` +
						"Conditional schemas (if/then/else) cannot be resolved during static analysis " +
						"because they depend on runtime data. Consider using oneOf/anyOf combinators instead.",
					undefined,
					{ path: loc.schemaPath },
				);
			}
		}
	}

	// If unsupported schemas were found, return early with valid: false
	if (ctx.diagnostics.length > 0) {
		return {
			valid: false,
			diagnostics: ctx.diagnostics,
			outputSchema: {},
		};
	}

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

		// ── Special-case: map helper ─────────────────────────────────────
		// The `map` helper requires deep static analysis that the generic
		// helper path cannot perform: it must resolve the first argument as
		// an array-of-objects schema, then resolve the second argument (a
		// property name) within the item schema to infer the output type
		// `{ type: "array", items: <property schema> }`.
		if (helperName === MapHelpers.MAP_HELPER_NAME) {
			return processMapHelper(stmt, ctx);
		}

		// ── Special-case: default helper ─────────────────────────────────
		// The `default` helper requires deep static analysis: the return
		// type is the union of all argument types, and the chain must
		// terminate with a guaranteed (non-optional) value.
		if (helperName === DefaultHelpers.DEFAULT_HELPER_NAME) {
			return processDefaultHelper(stmt, ctx);
		}

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
	const resolved = resolveExpressionWithDiagnostics(stmt.path, ctx, stmt) ?? {};

	// @data variables (@index, @first, @last, @key) are runtime-provided —
	// optionality checks against the input schema do not apply.
	if (isDataExpression(stmt.path)) {
		return resolved;
	}

	// When the expression points to an optional property (not in `required`),
	// the output can be null at runtime. Wrap the resolved schema with null
	// so the output schema accurately reflects this.
	// $root returns the entire context — optionality does not apply.
	if (stmt.path.type === "PathExpression") {
		const segments = extractPathSegments(stmt.path);
		if (segments.length > 0) {
			const { cleanSegments, identifier } =
				extractExpressionIdentifier(segments);
			if (!isRootSegments(cleanSegments)) {
				let targetSchema =
					identifier !== null
						? ctx.identifierSchemas?.[identifier]
						: ctx.current;
				// For aggregated identifiers (array schema), check optionality
				// within the items schema, not the array itself.
				if (targetSchema && identifier !== null) {
					const itemSchema = resolveArrayItems(targetSchema, ctx.root);
					if (itemSchema !== undefined) {
						targetSchema = itemSchema;
					}
				}
				if (targetSchema && !isPathFullyRequired(targetSchema, cleanSegments)) {
					return withNullType(resolved);
				}
			}
		}
	}

	return resolved;
}

// ─── map helper — special-case analysis ──────────────────────────────────────
// Validates the arguments and infers the precise return type:
//   {{ map <arrayPath> <propertyName> }}
//   → { type: "array", items: <schema of the property in the item> }
//
// Validation rules:
// 1. Exactly 2 arguments are required
// 2. The first argument must resolve to an array schema
// 3. The array items must be an object schema
// 4. The second argument must be a string literal (property name)
// 5. The property must exist in the item schema

function processMapHelper(
	stmt: hbs.AST.MustacheStatement,
	ctx: AnalysisContext,
): JSONSchema7 {
	const helperName = MapHelpers.MAP_HELPER_NAME;

	// ── 1. Check argument count ──────────────────────────────────────────
	if (stmt.params.length < 2) {
		addDiagnostic(
			ctx,
			"MISSING_ARGUMENT",
			"error",
			`Helper "${helperName}" expects at least 2 argument(s), but got ${stmt.params.length}`,
			stmt,
			{
				helperName,
				expected: "2 argument(s)",
				actual: `${stmt.params.length} argument(s)`,
			},
		);
		return { type: "array" };
	}

	// ── 2. Resolve the first argument (collection path) ──────────────────
	const collectionExpr = stmt.params[0] as hbs.AST.Expression;
	const collectionSchema = resolveExpressionWithDiagnostics(
		collectionExpr,
		ctx,
		stmt,
	);

	if (!collectionSchema) {
		// Path resolution failed — diagnostic already emitted
		return { type: "array" };
	}

	// ── 3. Validate that the collection is an array ──────────────────────
	const itemSchema = resolveArrayItems(collectionSchema, ctx.root);
	if (!itemSchema) {
		addDiagnostic(
			ctx,
			"TYPE_MISMATCH",
			"error",
			`Helper "${helperName}" parameter "collection" expects an array, but got ${schemaTypeLabel(collectionSchema)}`,
			stmt,
			{
				helperName,
				expected: "array",
				actual: schemaTypeLabel(collectionSchema),
			},
		);
		return { type: "array" };
	}

	// ── 4. Validate that the items are objects ───────────────────────────
	// If the items are arrays (e.g. from a nested map), flatten one level
	// to match the runtime `flat(1)` behavior and use the inner items instead.
	let effectiveItemSchema = itemSchema;
	const itemType = effectiveItemSchema.type;
	if (
		itemType === "array" ||
		(Array.isArray(itemType) && itemType.includes("array"))
	) {
		const innerItems = resolveArrayItems(effectiveItemSchema, ctx.root);
		if (innerItems) {
			effectiveItemSchema = innerItems;
			// Emit an informational warning so consumers know the flatten happened
			addDiagnostic(
				ctx,
				"MAP_IMPLICIT_FLATTEN",
				"warning",
				`The "${helperName}" helper will automatically flatten the input array one level before mapping. ` +
					`The item type "${Array.isArray(itemType) ? itemType.join(" | ") : itemType}" was unwrapped to its inner items schema.`,
				stmt,
				{
					helperName,
					expected: "object",
					actual: schemaTypeLabel(effectiveItemSchema),
				},
			);
		}
	}

	const effectiveItemType = effectiveItemSchema.type;
	const isObject =
		effectiveItemType === "object" ||
		(Array.isArray(effectiveItemType) &&
			effectiveItemType.includes("object")) ||
		// If no type but has properties, treat as object
		(!effectiveItemType && effectiveItemSchema.properties !== undefined);

	if (!isObject && effectiveItemType !== undefined) {
		addDiagnostic(
			ctx,
			"TYPE_MISMATCH",
			"error",
			`Helper "${helperName}" expects an array of objects, but the array items have type "${schemaTypeLabel(effectiveItemSchema)}"`,
			stmt,
			{
				helperName,
				expected: "object",
				actual: schemaTypeLabel(effectiveItemSchema),
			},
		);
		return { type: "array" };
	}

	// ── 5. Validate the second argument (property name) ──────────────────
	const propertyExpr = stmt.params[1] as hbs.AST.Expression;

	// The property name MUST be a StringLiteral (quoted string like `"name"`).
	// A bare identifier like `name` is parsed by Handlebars as a PathExpression,
	// which would be resolved as a data path at runtime — yielding `undefined`
	// when the identifier doesn't exist in the top-level context. This is a
	// common mistake, so we provide a clear error message guiding the user.
	let propertyName: string | undefined;

	if (propertyExpr.type === "PathExpression") {
		const bare = (propertyExpr as hbs.AST.PathExpression).original;
		addDiagnostic(
			ctx,
			"TYPE_MISMATCH",
			"error",
			`Helper "${helperName}" parameter "property" must be a quoted string. ` +
				`Use {{ ${helperName} … "${bare}" }} instead of {{ ${helperName} … ${bare} }}`,
			stmt,
			{
				helperName,
				expected: 'StringLiteral (e.g. "property")',
				actual: `PathExpression (${bare})`,
			},
		);
		return { type: "array" };
	}

	if (propertyExpr.type === "StringLiteral") {
		propertyName = (propertyExpr as hbs.AST.StringLiteral).value;
	}

	if (!propertyName) {
		addDiagnostic(
			ctx,
			"TYPE_MISMATCH",
			"error",
			`Helper "${helperName}" parameter "property" expects a quoted string literal, but got ${propertyExpr.type}`,
			stmt,
			{
				helperName,
				expected: 'StringLiteral (e.g. "property")',
				actual: propertyExpr.type,
			},
		);
		return { type: "array" };
	}

	// ── 6. Resolve the property within the item schema ───────────────────
	const propertySchema = resolveSchemaPath(effectiveItemSchema, [propertyName]);
	if (!propertySchema) {
		const availableProperties = getSchemaPropertyNames(effectiveItemSchema);
		addDiagnostic(
			ctx,
			"UNKNOWN_PROPERTY",
			"error",
			createPropertyNotFoundMessage(propertyName, availableProperties),
			stmt,
			{
				path: propertyName,
				availableProperties,
			},
		);
		return { type: "array" };
	}

	// ── 7. Return the inferred output schema ─────────────────────────────
	return { type: "array", items: propertySchema };
}

// ─── default helper — special-case analysis ──────────────────────────────────
// Validates the arguments and infers the return type as the union of all
// argument types. The chain must terminate with a guaranteed value.
//
// Validation rules:
// 1. At least 2 arguments are required
// 2. All arguments must be type-compatible
// 3. The chain must end with a guaranteed value (literal, required property,
//    or sub-expression)

/**
 * Analyzes a `default` helper MustacheStatement and returns the inferred
 * output schema. Shared logic with `processDefaultSubExpression`.
 */
function processDefaultHelper(
	stmt: hbs.AST.MustacheStatement,
	ctx: AnalysisContext,
): JSONSchema7 {
	return analyzeDefaultArgs(stmt.params as hbs.AST.Expression[], ctx, stmt);
}

/**
 * Analyzes a `default` helper SubExpression and returns the inferred
 * output schema.
 */
function processDefaultSubExpression(
	expr: hbs.AST.SubExpression,
	ctx: AnalysisContext,
	parentNode?: hbs.AST.Node,
): JSONSchema7 {
	return analyzeDefaultArgs(
		expr.params as hbs.AST.Expression[],
		ctx,
		parentNode ?? expr,
	);
}

/**
 * Core analysis logic for the `default` helper (shared by Mustache and
 * SubExpression paths).
 *
 * 1. Validates argument count (≥ 2)
 * 2. Resolves the schema of each argument
 * 3. Checks type compatibility between all arguments
 * 4. Verifies that at least one argument is guaranteed (non-optional)
 * 5. Returns the simplified union of all argument types
 */
function analyzeDefaultArgs(
	params: hbs.AST.Expression[],
	ctx: AnalysisContext,
	node: hbs.AST.Node,
): JSONSchema7 {
	const helperName = DefaultHelpers.DEFAULT_HELPER_NAME;

	// ── 1. Check argument count ──────────────────────────────────────────
	if (params.length < 2) {
		addDiagnostic(
			ctx,
			"MISSING_ARGUMENT",
			"error",
			`Helper "${helperName}" expects at least 2 argument(s), but got ${params.length}`,
			node,
			{
				helperName,
				expected: "2 argument(s)",
				actual: `${params.length} argument(s)`,
			},
		);
		return {};
	}

	// ── 2. Resolve the schema of each argument ───────────────────────────
	const resolvedSchemas: JSONSchema7[] = [];
	let hasGuaranteedValue = false;

	for (let i = 0; i < params.length; i++) {
		const param = params[i] as hbs.AST.Expression;
		const resolvedSchema = resolveExpressionWithDiagnostics(param, ctx, node);

		if (resolvedSchema) {
			resolvedSchemas.push(resolvedSchema);
		}

		// ── 3. Check if this argument is guaranteed ──────────────────────
		if (isGuaranteedExpression(param, ctx)) {
			hasGuaranteedValue = true;
		}
	}

	// ── 4. Check type compatibility between all arguments ────────────────
	// All arguments must be compatible with each other. We compare each
	// pair of resolved schemas (only those with type info).
	if (resolvedSchemas.length >= 2) {
		const firstWithType = resolvedSchemas.find((s) => s.type);
		if (firstWithType) {
			for (let i = 0; i < resolvedSchemas.length; i++) {
				const schema = resolvedSchemas[i] as JSONSchema7;
				if (schema.type && !isParamTypeCompatible(schema, firstWithType)) {
					addDiagnostic(
						ctx,
						"TYPE_MISMATCH",
						"error",
						`Helper "${helperName}" argument ${i + 1} has type ${schemaTypeLabel(schema)}, incompatible with ${schemaTypeLabel(firstWithType)}`,
						node,
						{
							helperName,
							expected: schemaTypeLabel(firstWithType),
							actual: schemaTypeLabel(schema),
						},
					);
				}
			}
		}
	}

	// ── 5. Verify the chain terminates with a guaranteed value ───────────
	if (!hasGuaranteedValue) {
		addDiagnostic(
			ctx,
			"DEFAULT_NO_GUARANTEED_VALUE",
			"error",
			`Helper "${helperName}" argument chain has no guaranteed fallback — ` +
				"the last argument must be a literal or a non-optional property",
			node,
			{ helperName },
		);
	}

	// ── 6. Return the union of all argument types ────────────────────────
	if (resolvedSchemas.length === 0) return {};
	if (resolvedSchemas.length === 1) return resolvedSchemas[0] as JSONSchema7;

	return simplifySchema({ oneOf: resolvedSchemas });
}

/**
 * Determines whether a template expression is **guaranteed** to produce a
 * non-nullish value at runtime.
 *
 * An expression is guaranteed when:
 * - It is a literal (StringLiteral, NumberLiteral, BooleanLiteral)
 * - It is a SubExpression (helpers always return a value)
 * - It is a PathExpression pointing to a **required** property in the schema
 */
function isGuaranteedExpression(
	expr: hbs.AST.Expression,
	ctx: AnalysisContext,
): boolean {
	// Literals are always guaranteed
	if (
		expr.type === "StringLiteral" ||
		expr.type === "NumberLiteral" ||
		expr.type === "BooleanLiteral"
	) {
		return true;
	}

	// Sub-expressions (helper calls) are considered guaranteed
	if (expr.type === "SubExpression") {
		return true;
	}

	// PathExpression: check if the property is required in the schema
	if (expr.type === "PathExpression") {
		const segments = extractPathSegments(expr);
		if (segments.length === 0) return false;

		const { cleanSegments } = extractExpressionIdentifier(segments);
		return isPropertyRequired(ctx.current, cleanSegments);
	}

	return false;
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

		// If an explicit coerceSchema was provided and declares a specific
		// primitive type, respect it instead of auto-detecting. For example,
		// "123" with coerceSchema `{ type: "string" }` should stay "string".
		// This only applies when coerceSchema is explicitly set — the
		// inputSchema is NEVER used for coercion.
		//
		// Only the **type** is extracted from coerceSchema. Value-level
		// constraints (enum, const, format, pattern, minLength, …) are NOT
		// propagated because they describe what the *consumer* accepts, not
		// what the literal *produces*. The actual literal value is set as
		// `const` so downstream compatibility checkers can detect mismatches.
		const coercedType = ctx.coerceSchema?.type;
		if (
			typeof coercedType === "string" &&
			(coercedType === "string" ||
				coercedType === "number" ||
				coercedType === "integer" ||
				coercedType === "boolean" ||
				coercedType === "null")
		) {
			const coercedValue = coerceTextValue(text, coercedType);
			return { type: coercedType, const: coercedValue } as JSONSchema7;
		}

		const literalType = detectLiteralType(text);
		if (literalType) return { type: literalType };
	}

	// ── Case 4: multiple blocks only (no significant text between them) ────
	// When the effective body consists entirely of BlockStatements, gather
	// each block's inferred type and combine them via oneOf. This handles
	// templates like:
	//   {{#if showName}}{{name}}{{/if}}
	//   {{#if showAge}}{{age}}{{/if}}
	// where the output could be string OR number depending on which branch
	// is active.
	const allBlocks = effective.every((s) => s.type === "BlockStatement");
	if (allBlocks) {
		const types: JSONSchema7[] = [];
		for (const stmt of effective) {
			const t = inferBlockType(stmt as hbs.AST.BlockStatement, ctx);
			if (t) types.push(t);
		}
		if (types.length === 1) return types[0] as JSONSchema7;
		if (types.length > 1) return simplifySchema({ oneOf: types });
		return { type: "string" };
	}

	// ── Case 5: mixed template (text + expressions, blocks…) ───────────────
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

// ─── @data variable types ────────────────────────────────────────────────────
// Handlebars injects these variables inside block helpers at runtime.
// We map each known variable to its static type so the analyzer can
// validate templates that use them without false UNKNOWN_PROPERTY errors.

const DATA_VARIABLE_SCHEMAS: Record<string, JSONSchema7> = {
	index: { type: "number" },
	first: { type: "boolean" },
	last: { type: "boolean" },
	key: { type: "string" },
};

/**
 * Returns the inferred schema for a Handlebars `@data` variable.
 * Known variables (`@index`, `@first`, `@last`, `@key`) return their
 * concrete type; unknown `@data` variables return the open schema `{}`
 * (any type) to avoid blocking valid templates.
 */
function resolveDataExpression(expr: hbs.AST.PathExpression): JSONSchema7 {
	const name = expr.parts[0];
	if (name && name in DATA_VARIABLE_SCHEMAS) {
		return DATA_VARIABLE_SCHEMAS[name] as JSONSchema7;
	}
	// Unknown @data variable — return open schema (best-effort)
	return {};
}

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

	// ── Handlebars @data variables (@index, @first, @last, @key) ────────────
	// These are runtime-provided by Handlebars inside block helpers (e.g.
	// `#each`). They are NOT part of the user's input schema, so we must
	// short-circuit here to avoid false UNKNOWN_PROPERTY diagnostics.
	if (isDataExpression(expr)) {
		return resolveDataExpression(expr as hbs.AST.PathExpression);
	}

	// ── SubExpression (nested helper call, e.g. `(lt account.balance 500)`) ──
	if (expr.type === "SubExpression") {
		return resolveSubExpression(expr as hbs.AST.SubExpression, ctx, parentNode);
	}

	const segments = extractPathSegments(expr);
	if (segments.length === 0) {
		// Expression that is not a PathExpression (e.g. literal)
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
	// Extract the `:N` suffix BEFORE checking for `$root` so that both
	// `{{$root}}` and `{{$root:2}}` are handled uniformly.
	const { cleanSegments, identifier } = extractExpressionIdentifier(segments);

	// ── $root token ──────────────────────────────────────────────────────
	// Path traversal ($root.name, $root.address.city) is always forbidden,
	// regardless of whether an identifier is present.
	if (isRootPathTraversal(cleanSegments)) {
		const fullPath = cleanSegments.join(".");
		addDiagnostic(
			ctx,
			"ROOT_PATH_TRAVERSAL",
			"error",
			createRootPathTraversalMessage(fullPath),
			parentNode ?? expr,
			{ path: fullPath },
		);
		return undefined;
	}

	// `{{$root}}` → return the entire current context schema
	// `{{$root:N}}` → return the entire schema for identifier N
	if (isRootSegments(cleanSegments)) {
		if (identifier !== null) {
			return resolveRootWithIdentifier(identifier, ctx, parentNode ?? expr);
		}
		return ctx.current;
	}

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
 * Resolves `{{$root:N}}` — returns the **entire** schema for identifier N.
 *
 * This is the identifier-aware counterpart of returning `ctx.current` for
 * a plain `{{$root}}`. Instead of navigating into properties, it returns
 * the identifier's root schema directly.
 *
 * When the identifier schema is an array (aggregated multi-version data),
 * the full array schema is returned as-is — the caller receives the
 * complete `{ type: "array", items: ... }` schema.
 *
 * Emits an error diagnostic if:
 * - No `identifierSchemas` were provided
 * - Identifier N has no associated schema
 */
function resolveRootWithIdentifier(
	identifier: number,
	ctx: AnalysisContext,
	node: hbs.AST.Node,
): JSONSchema7 | undefined {
	// No identifierSchemas provided at all
	if (!ctx.identifierSchemas) {
		addDiagnostic(
			ctx,
			"MISSING_IDENTIFIER_SCHEMAS",
			"error",
			`Property "$root:${identifier}" uses an identifier but no identifier schemas were provided`,
			node,
			{ path: `$root:${identifier}`, identifier },
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
			`Property "$root:${identifier}" references identifier ${identifier} but no schema exists for this identifier`,
			node,
			{ path: `$root:${identifier}`, identifier },
		);
		return undefined;
	}

	// Return the entire schema for identifier N.
	// For aggregated identifiers (array schemas), this returns the full
	// array schema — e.g. { type: "array", items: { type: "object", ... } }
	return idSchema;
}

/**
 * Resolves an expression with identifier `{{key:N}}` by looking up the
 * schema associated with identifier N.
 *
 * When the identifier schema is an array (aggregated multi-version data),
 * the property is resolved within the array's `items` schema, and the
 * result is wrapped in `{ type: "array", items: <resolved> }`. This
 * models the runtime behavior where `{{accountId:4}}` on an array of
 * objects extracts the property from each element, producing an array.
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

	// ── Aggregated identifier (array schema) ─────────────────────────────
	// When the identifier schema is an array of objects (e.g. from a
	// multi-versioned workflow node), resolve the property within the
	// items schema and wrap the result in an array type.
	//
	// Example: identifierSchemas[4] = { type: "array", items: { type: "object",
	//   properties: { accountId: { type: "string" } } } }
	// Expression: {{accountId:4}}
	// Result: { type: "array", items: { type: "string" } }
	const itemSchema = resolveArrayItems(idSchema, ctx.root);
	if (itemSchema !== undefined) {
		// The identifier schema is an array — resolve within items
		const resolved = resolveSchemaPath(itemSchema, cleanSegments);
		if (resolved === undefined) {
			const availableProperties = getSchemaPropertyNames(itemSchema);
			addDiagnostic(
				ctx,
				"IDENTIFIER_PROPERTY_NOT_FOUND",
				"error",
				`Property "${fullPath}" does not exist in the items schema for identifier ${identifier}`,
				node,
				{
					path: fullPath,
					identifier,
					availableProperties,
				},
			);
			return undefined;
		}
		// Wrap the resolved property schema in an array
		return { type: "array", items: resolved };
	}

	// ── Standard identifier (single object schema) ───────────────────────
	// Resolve the path within the identifier's schema directly.
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

// ─── Nullable Schema Wrapping ────────────────────────────────────────────────

/**
 * Wraps a JSON Schema with `null` to indicate the value can be nullish.
 *
 * - If the schema already includes `null`, it is returned as-is.
 * - For schemas with a simple `type` string, the type becomes an array
 *   (e.g. `{ type: "string" }` → `{ type: ["string", "null"] }`).
 * - For schemas with a type array, `"null"` is appended.
 * - For complex schemas (oneOf, anyOf, etc.), a `oneOf` wrapper is used.
 */
function withNullType(schema: JSONSchema7): JSONSchema7 {
	if (schema.type === "null") return schema;

	if (typeof schema.type === "string") {
		return { ...schema, type: [schema.type, "null"] };
	}

	if (Array.isArray(schema.type)) {
		if (schema.type.includes("null")) return schema;
		return { ...schema, type: [...schema.type, "null"] };
	}

	// Complex schema (oneOf, anyOf, allOf, etc.) — wrap with oneOf
	return simplifySchema({ oneOf: [schema, { type: "null" }] });
}

/**
 * Checks whether EVERY segment along a property path is required.
 *
 * Unlike `isPropertyRequired` (which only checks the last segment),
 * this function verifies that no intermediate segment is optional.
 * If any segment along the path is optional, the entire expression
 * can produce `null`/`undefined` at runtime.
 *
 * Intrinsic array accesses (`.length`, `.[N]`) are always considered
 * required — they are synthesized by the schema resolver and do not
 * appear in any `required` array.
 *
 * Example: for path `["user", "name"]`, checks both that `user` is
 * required in the root schema AND that `name` is required in `user`.
 */
function isPathFullyRequired(schema: JSONSchema7, segments: string[]): boolean {
	for (let i = 1; i <= segments.length; i++) {
		if (!isPropertyRequired(schema, segments.slice(0, i))) {
			// Intrinsic array access: .length and .[N] are always available
			// on array schemas. They are not listed in `required` because
			// they are synthesized by the schema resolver, not real properties.
			if (i >= 2) {
				const parentSchema = resolveSchemaPath(
					schema,
					segments.slice(0, i - 1),
				);
				if (parentSchema && parentSchema.type === "array") {
					continue;
				}
			}
			return false;
		}
	}
	return true;
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
// ─── SubExpression Resolution ────────────────────────────────────────────────

/**
 * Resolves a SubExpression (nested helper call) such as `(lt account.balance 500)`.
 *
 * This mirrors the helper-call logic in `processMustache` but applies to
 * expressions used as arguments (e.g. inside `{{#if (lt a b)}}`).
 *
 * Steps:
 * 1. Extract the helper name from the SubExpression's path.
 * 2. Look up the helper in `ctx.helpers`.
 * 3. Validate argument count and types.
 * 4. Return the helper's declared `returnType` (defaults to `{ type: "string" }`).
 */
function resolveSubExpression(
	expr: hbs.AST.SubExpression,
	ctx: AnalysisContext,
	parentNode?: hbs.AST.Node,
): JSONSchema7 | undefined {
	const helperName = getExpressionName(expr.path);

	// ── Special-case: map helper ─────────────────────────────────────
	// The `map` helper requires deep static analysis to infer the
	// precise return type `{ type: "array", items: <property schema> }`.
	// The generic path would only return `{ type: "array" }` (the static
	// returnType), losing the item schema needed by nested map calls.
	if (helperName === MapHelpers.MAP_HELPER_NAME) {
		return processMapSubExpression(expr, ctx, parentNode);
	}

	// ── Special-case: default helper ─────────────────────────────────
	if (helperName === DefaultHelpers.DEFAULT_HELPER_NAME) {
		return processDefaultSubExpression(expr, ctx, parentNode);
	}

	const helper = ctx.helpers?.get(helperName);
	if (!helper) {
		addDiagnostic(
			ctx,
			"UNKNOWN_HELPER",
			"warning",
			`Unknown sub-expression helper "${helperName}" — cannot analyze statically`,
			parentNode ?? expr,
			{ helperName },
		);
		return { type: "string" };
	}

	const helperParams = helper.params;

	// ── Check the number of required parameters ──────────────────────
	if (helperParams) {
		const requiredCount = helperParams.filter((p) => !p.optional).length;
		if (expr.params.length < requiredCount) {
			addDiagnostic(
				ctx,
				"MISSING_ARGUMENT",
				"error",
				`Helper "${helperName}" expects at least ${requiredCount} argument(s), but got ${expr.params.length}`,
				parentNode ?? expr,
				{
					helperName,
					expected: `${requiredCount} argument(s)`,
					actual: `${expr.params.length} argument(s)`,
				},
			);
		}
	}

	// ── Validate each parameter (existence + type) ───────────────────
	for (let i = 0; i < expr.params.length; i++) {
		const resolvedSchema = resolveExpressionWithDiagnostics(
			expr.params[i] as hbs.AST.Expression,
			ctx,
			parentNode ?? expr,
		);

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
					parentNode ?? expr,
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

// ─── map helper — sub-expression analysis ────────────────────────────────────
// Mirrors processMapHelper but for SubExpression nodes (e.g.
// `(map users 'cartItems')` used as an argument to another helper).
// This enables nested map: `{{ map (map users 'cartItems') 'productId' }}`

function processMapSubExpression(
	expr: hbs.AST.SubExpression,
	ctx: AnalysisContext,
	parentNode?: hbs.AST.Node,
): JSONSchema7 {
	const helperName = MapHelpers.MAP_HELPER_NAME;
	const node = parentNode ?? expr;

	// ── 1. Check argument count ──────────────────────────────────────────
	if (expr.params.length < 2) {
		addDiagnostic(
			ctx,
			"MISSING_ARGUMENT",
			"error",
			`Helper "${helperName}" expects at least 2 argument(s), but got ${expr.params.length}`,
			node,
			{
				helperName,
				expected: "2 argument(s)",
				actual: `${expr.params.length} argument(s)`,
			},
		);
		return { type: "array" };
	}

	// ── 2. Resolve the first argument (collection path) ──────────────────
	const collectionExpr = expr.params[0] as hbs.AST.Expression;
	const collectionSchema = resolveExpressionWithDiagnostics(
		collectionExpr,
		ctx,
		node,
	);

	if (!collectionSchema) {
		return { type: "array" };
	}

	// ── 3. Validate that the collection is an array ──────────────────────
	const itemSchema = resolveArrayItems(collectionSchema, ctx.root);
	if (!itemSchema) {
		addDiagnostic(
			ctx,
			"TYPE_MISMATCH",
			"error",
			`Helper "${helperName}" parameter "collection" expects an array, but got ${schemaTypeLabel(collectionSchema)}`,
			node,
			{
				helperName,
				expected: "array",
				actual: schemaTypeLabel(collectionSchema),
			},
		);
		return { type: "array" };
	}

	// ── 4. Validate that the items are objects ───────────────────────────
	// If the items are arrays (e.g. from a nested map), flatten one level
	// to match the runtime `flat(1)` behavior and use the inner items instead.
	let effectiveItemSchema = itemSchema;
	const itemType = effectiveItemSchema.type;
	if (
		itemType === "array" ||
		(Array.isArray(itemType) && itemType.includes("array"))
	) {
		const innerItems = resolveArrayItems(effectiveItemSchema, ctx.root);
		if (innerItems) {
			effectiveItemSchema = innerItems;
		}
	}

	const effectiveItemType = effectiveItemSchema.type;
	const isObject =
		effectiveItemType === "object" ||
		(Array.isArray(effectiveItemType) &&
			effectiveItemType.includes("object")) ||
		(!effectiveItemType && effectiveItemSchema.properties !== undefined);

	if (!isObject && effectiveItemType !== undefined) {
		addDiagnostic(
			ctx,
			"TYPE_MISMATCH",
			"error",
			`Helper "${helperName}" expects an array of objects, but the array items have type "${schemaTypeLabel(effectiveItemSchema)}"`,
			node,
			{
				helperName,
				expected: "object",
				actual: schemaTypeLabel(effectiveItemSchema),
			},
		);
		return { type: "array" };
	}

	// ── 5. Validate the second argument (property name) ──────────────────
	const propertyExpr = expr.params[1] as hbs.AST.Expression;
	let propertyName: string | undefined;

	if (propertyExpr.type === "PathExpression") {
		const bare = (propertyExpr as hbs.AST.PathExpression).original;
		addDiagnostic(
			ctx,
			"TYPE_MISMATCH",
			"error",
			`Helper "${helperName}" parameter "property" must be a quoted string. ` +
				`Use (${helperName} … "${bare}") instead of (${helperName} … ${bare})`,
			node,
			{
				helperName,
				expected: 'StringLiteral (e.g. "property")',
				actual: `PathExpression (${bare})`,
			},
		);
		return { type: "array" };
	}

	if (propertyExpr.type === "StringLiteral") {
		propertyName = (propertyExpr as hbs.AST.StringLiteral).value;
	}

	if (!propertyName) {
		addDiagnostic(
			ctx,
			"TYPE_MISMATCH",
			"error",
			`Helper "${helperName}" parameter "property" expects a quoted string literal, but got ${propertyExpr.type}`,
			node,
			{
				helperName,
				expected: 'StringLiteral (e.g. "property")',
				actual: propertyExpr.type,
			},
		);
		return { type: "array" };
	}

	// ── 6. Resolve the property within the item schema ───────────────────
	const propertySchema = resolveSchemaPath(effectiveItemSchema, [propertyName]);
	if (!propertySchema) {
		const availableProperties = getSchemaPropertyNames(effectiveItemSchema);
		addDiagnostic(
			ctx,
			"UNKNOWN_PROPERTY",
			"error",
			createPropertyNotFoundMessage(propertyName, availableProperties),
			node,
			{
				path: propertyName,
				availableProperties,
			},
		);
		return { type: "array" };
	}

	// ── 7. Return the inferred output schema ─────────────────────────────
	return { type: "array", items: propertySchema };
}

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
