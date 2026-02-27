import Handlebars from "handlebars";
import { TemplateParseError } from "./errors.ts";

// ─── Regex for detecting a template identifier (e.g. "meetingId:1") ──────────
// The identifier is always a positive integer or zero, separated from the
// variable name by a `:`. The `:` and number are on the **last** segment
// of the path (Handlebars splits on `.`).
const IDENTIFIER_RE = /^(.+):(\d+)$/;

// ─── Template Parser ─────────────────────────────────────────────────────────
// Thin wrapper around the Handlebars parser. Centralizing the parser call
// here allows us to:
// 1. Wrap errors into our own hierarchy (`TemplateParseError`)
// 2. Expose AST introspection helpers (e.g. `isSingleExpression`)
// 3. Isolate the direct Handlebars dependency from the rest of the codebase
//
// AST caching is handled at the `Typebars` instance level (via its own
// configurable LRU cache), not here. This module only parses and wraps errors.

// ─── Regex for detecting a numeric literal (integer or decimal, signed) ──────
// Intentionally conservative: no scientific notation (1e5), no hex (0xFF),
// no separators (1_000). We only want to recognize what a human would write
// as a numeric value in a template.
const NUMERIC_LITERAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Parses a template string and returns the Handlebars AST.
 *
 * This function does not cache results — caching is managed at the
 * `Typebars` instance level via its own configurable LRU cache.
 *
 * @param template - The template string to parse (e.g. `"Hello {{name}}"`)
 * @returns The root AST node (`hbs.AST.Program`)
 * @throws {TemplateParseError} if the template syntax is invalid
 */
export function parse(template: string): hbs.AST.Program {
	try {
		return Handlebars.parse(template);
	} catch (error: unknown) {
		// Handlebars throws a plain Error with a descriptive message.
		// We transform it into a TemplateParseError for uniform handling.
		const message = error instanceof Error ? error.message : String(error);

		// Handlebars sometimes includes the position in the message —
		// attempt to extract it to enrich our error.
		const locMatch = message.match(/line\s+(\d+).*?column\s+(\d+)/i);
		const loc = locMatch
			? {
					line: parseInt(locMatch[1] ?? "0", 10),
					column: parseInt(locMatch[2] ?? "0", 10),
				}
			: undefined;

		throw new TemplateParseError(message, loc);
	}
}

/**
 * Determines whether the AST represents a template consisting of a single
 * expression `{{expression}}` with no text content around it.
 *
 * This matters for return type inference:
 * - Template `{{value}}`       → returns the raw type of `value` (number, object…)
 * - Template `Hello {{name}}`  → always returns `string` (concatenation)
 *
 * @param ast - The parsed AST of the template
 * @returns `true` if the template is a single expression
 */
export function isSingleExpression(ast: hbs.AST.Program): boolean {
	const { body } = ast;

	// Exactly one node, and it's a MustacheStatement (not a block, not text)
	return body.length === 1 && body[0]?.type === "MustacheStatement";
}

/**
 * Extracts the path segments from a Handlebars `PathExpression`.
 *
 * Handlebars decomposes `user.address.city` into `{ parts: ["user", "address", "city"] }`.
 * This function safely extracts those segments.
 *
 * @param expr - The expression to extract the path from
 * @returns The path segments, or an empty array if the expression is not
 *          a `PathExpression`
 */
export function extractPathSegments(expr: hbs.AST.Expression): string[] {
	if (expr.type === "PathExpression") {
		return (expr as hbs.AST.PathExpression).parts;
	}
	return [];
}

/**
 * Checks whether an AST expression is a `PathExpression` pointing to `this`
 * (used inside `{{#each}}` blocks).
 */
export function isThisExpression(expr: hbs.AST.Expression): boolean {
	if (expr.type !== "PathExpression") return false;
	const path = expr as hbs.AST.PathExpression;
	return path.original === "this" || path.original === ".";
}

// ─── Filtering Semantically Significant Nodes ───────────────────────────────
// In a Handlebars AST, formatting (newlines, indentation) produces
// `ContentStatement` nodes whose value is purely whitespace. These nodes
// have no semantic impact and must be ignored during type inference to
// correctly detect "effectively a single block" or "effectively a single
// expression" cases.

/**
 * Returns the semantically significant statements of a Program by
 * filtering out `ContentStatement` nodes that contain only whitespace.
 */
export function getEffectiveBody(
	program: hbs.AST.Program,
): hbs.AST.Statement[] {
	return program.body.filter(
		(s) =>
			!(
				s.type === "ContentStatement" &&
				(s as hbs.AST.ContentStatement).value.trim() === ""
			),
	);
}

/**
 * Determines whether a Program effectively consists of a single
 * `BlockStatement` (ignoring surrounding whitespace).
 *
 * Recognized examples:
 * ```
 * {{#if x}}...{{/if}}
 *
 *   {{#each items}}...{{/each}}
 * ```
 *
 * @returns The single `BlockStatement`, or `null` if the program contains
 *          other significant nodes.
 */
export function getEffectivelySingleBlock(
	program: hbs.AST.Program,
): hbs.AST.BlockStatement | null {
	const effective = getEffectiveBody(program);
	if (effective.length === 1 && effective[0]?.type === "BlockStatement") {
		return effective[0] as hbs.AST.BlockStatement;
	}
	return null;
}

/**
 * Determines whether a Program effectively consists of a single
 * `MustacheStatement` (ignoring surrounding whitespace).
 *
 * Example: `  {{age}}  ` → true
 */
export function getEffectivelySingleExpression(
	program: hbs.AST.Program,
): hbs.AST.MustacheStatement | null {
	const effective = getEffectiveBody(program);
	if (effective.length === 1 && effective[0]?.type === "MustacheStatement") {
		return effective[0] as hbs.AST.MustacheStatement;
	}
	return null;
}

// ─── Fast-Path Detection ─────────────────────────────────────────────────────
// For templates consisting only of text and simple expressions (no blocks,
// no helpers with parameters), we can bypass Handlebars entirely and perform
// a simple variable replacement via string concatenation.

/**
 * Determines whether an AST can be executed via the fast-path (direct
 * concatenation without going through `Handlebars.compile()`).
 *
 * The fast-path is possible when the template only contains:
 * - `ContentStatement` nodes (static text)
 * - Simple `MustacheStatement` nodes (no params, no hash)
 *
 * This excludes:
 * - Block helpers (`{{#if}}`, `{{#each}}`, etc.)
 * - Inline helpers (`{{uppercase name}}`)
 * - Sub-expressions
 *
 * @param ast - The parsed AST of the template
 * @returns `true` if the template can use the fast-path
 */
export function canUseFastPath(ast: hbs.AST.Program): boolean {
	return ast.body.every(
		(s) =>
			s.type === "ContentStatement" ||
			(s.type === "MustacheStatement" &&
				(s as hbs.AST.MustacheStatement).params.length === 0 &&
				!(s as hbs.AST.MustacheStatement).hash),
	);
}

// ─── Literal Detection in Text Content ───────────────────────────────────────
// When a program contains only ContentStatements (no expressions), we try
// to detect whether the concatenated and trimmed text is a typed literal
// (number, boolean, null). This enables correct type inference for branches
// like `{{#if x}}  42  {{/if}}`.

/**
 * Attempts to detect the type of a raw text literal.
 *
 * @param text - The trimmed text from a ContentStatement or group of ContentStatements
 * @returns The detected JSON Schema type, or `null` if it's free-form text (string).
 */
export function detectLiteralType(
	text: string,
): "number" | "boolean" | "null" | null {
	if (NUMERIC_LITERAL_RE.test(text)) return "number";
	if (text === "true" || text === "false") return "boolean";
	if (text === "null") return "null";
	return null;
}

/**
 * Coerces a raw string from Handlebars rendering to its actual type
 * if it represents a literal (number, boolean, null).
 * Returns the raw (untrimmed) string otherwise.
 */
export function coerceLiteral(raw: string): unknown {
	const trimmed = raw.trim();
	const type = detectLiteralType(trimmed);
	if (type === "number") return Number(trimmed);
	if (type === "boolean") return trimmed === "true";
	if (type === "null") return null;
	// Not a typed literal — return the raw string without trimming,
	// as whitespace may be significant (e.g. output of an #each block).
	return raw;
}

// ─── Template Identifier Parsing ─────────────────────────────────────────────
// Syntax `{{key:N}}` where N is a positive integer or zero.
// The identifier allows resolving a variable from a specific data source
// (e.g. a workflow node identified by its number).

/** Result of parsing a path segment with a potential identifier */
export interface ParsedIdentifier {
	/** The variable name, without the `:N` suffix */
	key: string;
	/** The numeric identifier, or `null` if absent */
	identifier: number | null;
}

/**
 * Parses an individual path segment to extract the key and optional identifier.
 *
 * @param segment - A raw path segment (e.g. `"meetingId:1"` or `"meetingId"`)
 * @returns An object `{ key, identifier }`
 *
 * @example
 * ```
 * parseIdentifier("meetingId:1")  // → { key: "meetingId", identifier: 1 }
 * parseIdentifier("meetingId")    // → { key: "meetingId", identifier: null }
 * parseIdentifier("meetingId:0")  // → { key: "meetingId", identifier: 0 }
 * ```
 */
export function parseIdentifier(segment: string): ParsedIdentifier {
	const match = segment.match(IDENTIFIER_RE);
	if (match) {
		return {
			key: match[1] ?? segment,
			identifier: parseInt(match[2] ?? "0", 10),
		};
	}
	return { key: segment, identifier: null };
}

/** Result of extracting the identifier from a complete expression */
export interface ExpressionIdentifier {
	/** Cleaned path segments (without the `:N` suffix on the last one) */
	cleanSegments: string[];
	/** The numeric identifier extracted from the last segment, or `null` */
	identifier: number | null;
}

/**
 * Extracts the identifier from a complete expression (array of segments).
 *
 * The identifier is always on the **last** segment of the path, because
 * Handlebars splits on `.` before the `:`.
 *
 * @param segments - The raw path segments (e.g. `["user", "name:1"]`)
 * @returns An object `{ cleanSegments, identifier }`
 *
 * @example
 * ```
 * extractExpressionIdentifier(["meetingId:1"])
 * // → { cleanSegments: ["meetingId"], identifier: 1 }
 *
 * extractExpressionIdentifier(["user", "name:1"])
 * // → { cleanSegments: ["user", "name"], identifier: 1 }
 *
 * extractExpressionIdentifier(["meetingId"])
 * // → { cleanSegments: ["meetingId"], identifier: null }
 * ```
 */
export function extractExpressionIdentifier(
	segments: string[],
): ExpressionIdentifier {
	if (segments.length === 0) {
		return { cleanSegments: [], identifier: null };
	}

	const lastSegment = segments[segments.length - 1] as string;
	const parsed = parseIdentifier(lastSegment);

	if (parsed.identifier !== null) {
		const cleanSegments = [...segments.slice(0, -1), parsed.key];
		return { cleanSegments, identifier: parsed.identifier };
	}

	return { cleanSegments: segments, identifier: null };
}
