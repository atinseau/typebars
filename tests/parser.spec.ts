import { describe, expect, test } from "bun:test";
import { TemplateParseError } from "../src/errors.ts";
import {
	canUseFastPath,
	coerceLiteral,
	detectLiteralType,
	extractExpressionIdentifier,
	extractPathSegments,
	getEffectiveBody,
	getEffectivelySingleBlock,
	getEffectivelySingleExpression,
	hasHandlebarsExpression,
	isRootExpression,
	isRootPathTraversal,
	isRootSegments,
	isSingleExpression,
	isThisExpression,
	parse,
	parseIdentifier,
} from "../src/parser.ts";

// ─── parse() ─────────────────────────────────────────────────────────────────

describe("parse", () => {
	test("returns a valid AST for a simple template", () => {
		const ast = parse("Hello {{name}}");
		expect(ast).toBeDefined();
		expect(ast.type).toBe("Program");
		expect(ast.body.length).toBe(2); // ContentStatement + MustacheStatement
	});

	test("returns an AST for a single expression", () => {
		const ast = parse("{{name}}");
		expect(ast.body.length).toBe(1);
		expect(ast.body[0]?.type).toBe("MustacheStatement");
	});

	test("handles #if blocks", () => {
		const ast = parse("{{#if active}}yes{{/if}}");
		expect(ast.body.length).toBe(1);
		expect(ast.body[0]?.type).toBe("BlockStatement");
	});

	test("handles #each blocks", () => {
		const ast = parse("{{#each items}}{{this}}{{/each}}");
		expect(ast.body[0]?.type).toBe("BlockStatement");
	});

	test("throws TemplateParseError for an invalid template", () => {
		expect(() => parse("{{#if x}}oops{{/each}}")).toThrow(TemplateParseError);
	});

	test("throws TemplateParseError for an unclosed block", () => {
		expect(() => parse("{{#if x}}")).toThrow(TemplateParseError);
	});

	test("accepts comments", () => {
		const ast = parse("{{!-- a comment --}}Hello");
		expect(ast.body.length).toBeGreaterThanOrEqual(1);
	});

	test("handles plain text without expressions", () => {
		const ast = parse("Just plain text");
		expect(ast.body.length).toBe(1);
		expect(ast.body[0]?.type).toBe("ContentStatement");
	});

	test("handles an empty template", () => {
		const ast = parse("");
		expect(ast.body.length).toBe(0);
	});

	test("TemplateParseError includes loc when available", () => {
		try {
			parse("{{#if x}}");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(TemplateParseError);
		}
	});
});

// ─── isSingleExpression() ────────────────────────────────────────────────────

describe("isSingleExpression", () => {
	test("returns true for a single mustache expression", () => {
		expect(isSingleExpression(parse("{{name}}"))).toBe(true);
	});

	test("returns false for text + expression", () => {
		expect(isSingleExpression(parse("Hello {{name}}"))).toBe(false);
	});

	test("returns false for multiple expressions", () => {
		expect(isSingleExpression(parse("{{a}} {{b}}"))).toBe(false);
	});

	test("returns false for a block statement", () => {
		expect(isSingleExpression(parse("{{#if x}}yes{{/if}}"))).toBe(false);
	});

	test("returns false for plain text", () => {
		expect(isSingleExpression(parse("just text"))).toBe(false);
	});

	test("returns false for empty template", () => {
		expect(isSingleExpression(parse(""))).toBe(false);
	});

	test("returns false for expression with surrounding whitespace (whitespace = content nodes)", () => {
		// "  {{name}}  " produces ContentStatement + MustacheStatement + ContentStatement
		expect(isSingleExpression(parse("  {{name}}  "))).toBe(false);
	});
});

// ─── extractPathSegments() ───────────────────────────────────────────────────

describe("extractPathSegments", () => {
	test("extracts segments from a simple path", () => {
		const ast = parse("{{name}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(extractPathSegments(stmt.path)).toEqual(["name"]);
	});

	test("extracts segments from a dotted path", () => {
		const ast = parse("{{user.address.city}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(extractPathSegments(stmt.path)).toEqual(["user", "address", "city"]);
	});

	test("returns empty array for non-PathExpression", () => {
		// A StringLiteral is not a PathExpression
		const ast = parse('{{#if "hello"}}yes{{/if}}');
		const block = ast.body[0] as hbs.AST.BlockStatement;
		// The param is a StringLiteral
		if (block.params[0]) {
			expect(
				extractPathSegments(block.params[0] as hbs.AST.Expression),
			).toEqual([]);
		}
	});
});

// ─── isThisExpression() ──────────────────────────────────────────────────────

describe("isThisExpression", () => {
	test("returns true for {{this}}", () => {
		const ast = parse("{{this}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(isThisExpression(stmt.path)).toBe(true);
	});

	test("returns true for {{.}}", () => {
		// Handlebars treats "." as equivalent to "this"
		const ast = parse("{{.}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(isThisExpression(stmt.path)).toBe(true);
	});

	test("returns false for a regular path", () => {
		const ast = parse("{{name}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(isThisExpression(stmt.path)).toBe(false);
	});

	test("returns false for a dotted path", () => {
		const ast = parse("{{user.name}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(isThisExpression(stmt.path)).toBe(false);
	});
});

// ─── isRootExpression() ──────────────────────────────────────────────────────

describe("isRootExpression", () => {
	test("returns true for {{$root}}", () => {
		const ast = parse("{{$root}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(isRootExpression(stmt.path)).toBe(true);
	});

	test("returns true for {{$root.name}} (multiple segments)", () => {
		const ast = parse("{{$root.name}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(isRootExpression(stmt.path)).toBe(true);
	});

	test("returns false for a regular path", () => {
		const ast = parse("{{name}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(isRootExpression(stmt.path)).toBe(false);
	});

	test("returns false for {{$root:2}} (identifier attached)", () => {
		// Handlebars parses "$root:2" as a single segment, not "$root"
		const ast = parse("{{$root:2}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		expect(isRootExpression(stmt.path)).toBe(false);
	});
});

// ─── isRootSegments() ────────────────────────────────────────────────────────

describe("isRootSegments", () => {
	test("returns true for ['$root']", () => {
		expect(isRootSegments(["$root"])).toBe(true);
	});

	test("returns false for ['$root', 'name'] (path traversal)", () => {
		expect(isRootSegments(["$root", "name"])).toBe(false);
	});

	test("returns false for ['name']", () => {
		expect(isRootSegments(["name"])).toBe(false);
	});

	test("returns false for empty array", () => {
		expect(isRootSegments([])).toBe(false);
	});
});

// ─── isRootPathTraversal() ───────────────────────────────────────────────────

describe("isRootPathTraversal", () => {
	test("returns true for ['$root', 'name']", () => {
		expect(isRootPathTraversal(["$root", "name"])).toBe(true);
	});

	test("returns true for ['$root', 'address', 'city']", () => {
		expect(isRootPathTraversal(["$root", "address", "city"])).toBe(true);
	});

	test("returns false for ['$root'] (no traversal)", () => {
		expect(isRootPathTraversal(["$root"])).toBe(false);
	});

	test("returns false for ['name'] (not $root)", () => {
		expect(isRootPathTraversal(["name"])).toBe(false);
	});

	test("returns false for empty array", () => {
		expect(isRootPathTraversal([])).toBe(false);
	});
});

// ─── getEffectiveBody() ──────────────────────────────────────────────────────

describe("getEffectiveBody", () => {
	test("filters out whitespace-only ContentStatements", () => {
		// "  {{name}}  " has whitespace content + mustache + whitespace content
		const ast = parse("  {{name}}  ");
		const effective = getEffectiveBody(ast);
		expect(effective.length).toBe(1);
		expect(effective[0]?.type).toBe("MustacheStatement");
	});

	test("preserves non-whitespace ContentStatements", () => {
		const ast = parse("Hello {{name}}");
		const effective = getEffectiveBody(ast);
		expect(effective.length).toBe(2);
		expect(effective[0]?.type).toBe("ContentStatement");
		expect(effective[1]?.type).toBe("MustacheStatement");
	});

	test("returns empty array for whitespace-only template", () => {
		const ast = parse("   ");
		const effective = getEffectiveBody(ast);
		expect(effective.length).toBe(0);
	});

	test("returns all nodes for template without whitespace", () => {
		const ast = parse("{{a}}{{b}}");
		const effective = getEffectiveBody(ast);
		expect(effective.length).toBe(2);
	});

	test("filters newlines and indentation around blocks", () => {
		const ast = parse("\n  {{#if x}}yes{{/if}}\n  ");
		const effective = getEffectiveBody(ast);
		expect(effective.length).toBe(1);
		expect(effective[0]?.type).toBe("BlockStatement");
	});
});

// ─── getEffectivelySingleBlock() ─────────────────────────────────────────────

describe("getEffectivelySingleBlock", () => {
	test("returns the block for a single block with whitespace", () => {
		const ast = parse("  {{#if x}}yes{{/if}}  ");
		const block = getEffectivelySingleBlock(ast);
		expect(block).not.toBeNull();
		expect(block?.type).toBe("BlockStatement");
	});

	test("returns the block for a single block without whitespace", () => {
		const ast = parse("{{#each items}}{{this}}{{/each}}");
		const block = getEffectivelySingleBlock(ast);
		expect(block).not.toBeNull();
	});

	test("returns null for text + block", () => {
		const ast = parse("Hello {{#if x}}yes{{/if}}");
		expect(getEffectivelySingleBlock(ast)).toBeNull();
	});

	test("returns null for a single expression", () => {
		const ast = parse("{{name}}");
		expect(getEffectivelySingleBlock(ast)).toBeNull();
	});

	test("returns null for multiple blocks", () => {
		const ast = parse("{{#if a}}x{{/if}}{{#if b}}y{{/if}}");
		expect(getEffectivelySingleBlock(ast)).toBeNull();
	});

	test("returns null for an empty template", () => {
		const ast = parse("");
		expect(getEffectivelySingleBlock(ast)).toBeNull();
	});
});

// ─── getEffectivelySingleExpression() ────────────────────────────────────────

describe("getEffectivelySingleExpression", () => {
	test("returns the expression for a single expression with whitespace", () => {
		const ast = parse("  {{age}}  ");
		const expr = getEffectivelySingleExpression(ast);
		expect(expr).not.toBeNull();
		expect(expr?.type).toBe("MustacheStatement");
	});

	test("returns the expression for a single expression without whitespace", () => {
		const ast = parse("{{name}}");
		const expr = getEffectivelySingleExpression(ast);
		expect(expr).not.toBeNull();
	});

	test("returns null for text + expression", () => {
		const ast = parse("Hi {{name}}");
		expect(getEffectivelySingleExpression(ast)).toBeNull();
	});

	test("returns null for a block statement", () => {
		const ast = parse("{{#if x}}yes{{/if}}");
		expect(getEffectivelySingleExpression(ast)).toBeNull();
	});

	test("returns null for multiple expressions", () => {
		const ast = parse("{{a}}{{b}}");
		expect(getEffectivelySingleExpression(ast)).toBeNull();
	});

	test("returns null for an empty template", () => {
		const ast = parse("");
		expect(getEffectivelySingleExpression(ast)).toBeNull();
	});
});

// ─── hasHandlebarsExpression() ───────────────────────────────────────────────

describe("hasHandlebarsExpression", () => {
	test("returns true for a string with {{expression}}", () => {
		expect(hasHandlebarsExpression("Hello {{name}}")).toBe(true);
	});

	test("returns true for a string with just {{", () => {
		expect(hasHandlebarsExpression("contains {{ somewhere")).toBe(true);
	});

	test("returns false for a plain string", () => {
		expect(hasHandlebarsExpression("Hello world")).toBe(false);
	});

	test("returns false for an empty string", () => {
		expect(hasHandlebarsExpression("")).toBe(false);
	});

	test("returns true for a block expression", () => {
		expect(hasHandlebarsExpression("{{#if x}}yes{{/if}}")).toBe(true);
	});

	test("returns true for a comment expression", () => {
		expect(hasHandlebarsExpression("{{!-- comment --}}")).toBe(true);
	});

	test("returns false for single opening brace", () => {
		expect(hasHandlebarsExpression("{ not a template }")).toBe(false);
	});

	test("returns true for escaped-looking content (limitation)", () => {
		// This is the documented limitation — simple includes("{{") check
		expect(hasHandlebarsExpression("Use {{name}} syntax in docs")).toBe(true);
	});
});

// ─── canUseFastPath() ────────────────────────────────────────────────────────

describe("canUseFastPath", () => {
	test("returns true for text + simple expressions", () => {
		expect(canUseFastPath(parse("Hello {{name}}, age {{age}}"))).toBe(true);
	});

	test("returns true for a single expression", () => {
		expect(canUseFastPath(parse("{{name}}"))).toBe(true);
	});

	test("returns true for plain text only", () => {
		expect(canUseFastPath(parse("Just text"))).toBe(true);
	});

	test("returns false for a block statement", () => {
		expect(canUseFastPath(parse("{{#if x}}yes{{/if}}"))).toBe(false);
	});

	test("returns false for a helper with parameters", () => {
		expect(canUseFastPath(parse("{{uppercase name}}"))).toBe(false);
	});

	test("returns false for a helper with hash", () => {
		expect(canUseFastPath(parse("{{helper key=value}}"))).toBe(false);
	});

	test("returns true for an empty template", () => {
		expect(canUseFastPath(parse(""))).toBe(true);
	});

	test("returns false for a mix of text and blocks", () => {
		expect(canUseFastPath(parse("Hello {{#if x}}y{{/if}}"))).toBe(false);
	});
});

// ─── detectLiteralType() ─────────────────────────────────────────────────────

describe("detectLiteralType", () => {
	test("detects integer numbers", () => {
		expect(detectLiteralType("42")).toBe("number");
		expect(detectLiteralType("0")).toBe("number");
		expect(detectLiteralType("-5")).toBe("number");
	});

	test("detects decimal numbers", () => {
		expect(detectLiteralType("3.14")).toBe("number");
		expect(detectLiteralType("-0.5")).toBe("number");
	});

	test("detects boolean true", () => {
		expect(detectLiteralType("true")).toBe("boolean");
	});

	test("detects boolean false", () => {
		expect(detectLiteralType("false")).toBe("boolean");
	});

	test("detects null", () => {
		expect(detectLiteralType("null")).toBe("null");
	});

	test("returns null for free-form text", () => {
		expect(detectLiteralType("hello")).toBeNull();
		expect(detectLiteralType("")).toBeNull();
		expect(detectLiteralType("abc123")).toBeNull();
	});

	test("does not detect scientific notation", () => {
		expect(detectLiteralType("1e5")).toBeNull();
	});

	test("does not detect hex", () => {
		expect(detectLiteralType("0xFF")).toBeNull();
	});

	test("does not detect numbers with separators", () => {
		expect(detectLiteralType("1_000")).toBeNull();
	});

	test("does not detect partial booleans", () => {
		expect(detectLiteralType("True")).toBeNull();
		expect(detectLiteralType("FALSE")).toBeNull();
	});

	test("does not detect 'Null' or 'NULL'", () => {
		expect(detectLiteralType("Null")).toBeNull();
		expect(detectLiteralType("NULL")).toBeNull();
	});
});

// ─── coerceLiteral() ─────────────────────────────────────────────────────────

describe("coerceLiteral", () => {
	test("coerces integer string to number", () => {
		expect(coerceLiteral("42")).toBe(42);
		expect(typeof coerceLiteral("42")).toBe("number");
	});

	test("coerces decimal string to number", () => {
		expect(coerceLiteral("3.14")).toBe(3.14);
	});

	test("coerces negative number", () => {
		expect(coerceLiteral("-5")).toBe(-5);
	});

	test("coerces 'true' to boolean true", () => {
		expect(coerceLiteral("true")).toBe(true);
	});

	test("coerces 'false' to boolean false", () => {
		expect(coerceLiteral("false")).toBe(false);
	});

	test("coerces 'null' to null", () => {
		expect(coerceLiteral("null")).toBeNull();
	});

	test("returns raw string for non-literal text", () => {
		expect(coerceLiteral("hello")).toBe("hello");
	});

	test("handles whitespace-surrounded literals (trims for detection)", () => {
		expect(coerceLiteral("  42  ")).toBe(42);
		expect(coerceLiteral("  true  ")).toBe(true);
		expect(coerceLiteral("  null  ")).toBeNull();
	});

	test("returns raw untrimmed string for non-literal", () => {
		// Non-literal text should NOT be trimmed — whitespace may be significant
		const raw = "  hello world  ";
		expect(coerceLiteral(raw)).toBe(raw);
	});

	test("returns empty string as-is (not a literal)", () => {
		expect(coerceLiteral("")).toBe("");
	});

	test("coerces '0' to number 0", () => {
		expect(coerceLiteral("0")).toBe(0);
	});
});

// ─── parseIdentifier() ──────────────────────────────────────────────────────

describe("parseIdentifier", () => {
	test("extracts key and identifier from 'meetingId:1'", () => {
		const result = parseIdentifier("meetingId:1");
		expect(result.key).toBe("meetingId");
		expect(result.identifier).toBe(1);
	});

	test("extracts key and identifier from 'meetingId:0'", () => {
		const result = parseIdentifier("meetingId:0");
		expect(result.key).toBe("meetingId");
		expect(result.identifier).toBe(0);
	});

	test("extracts large identifier numbers", () => {
		const result = parseIdentifier("key:999");
		expect(result.key).toBe("key");
		expect(result.identifier).toBe(999);
	});

	test("returns null identifier for plain key", () => {
		const result = parseIdentifier("meetingId");
		expect(result.key).toBe("meetingId");
		expect(result.identifier).toBeNull();
	});

	test("handles key with dots (last segment only)", () => {
		// This function receives individual segments, not full paths
		const result = parseIdentifier("name:1");
		expect(result.key).toBe("name");
		expect(result.identifier).toBe(1);
	});

	test("handles $root as key", () => {
		const result = parseIdentifier("$root");
		expect(result.key).toBe("$root");
		expect(result.identifier).toBeNull();
	});

	test("handles $root:2 as key with identifier", () => {
		const result = parseIdentifier("$root:2");
		expect(result.key).toBe("$root");
		expect(result.identifier).toBe(2);
	});

	test("extracts negative identifier from 'meetingId:-1'", () => {
		const result = parseIdentifier("meetingId:-1");
		expect(result.key).toBe("meetingId");
		expect(result.identifier).toBe(-1);
	});

	test("extracts large negative identifier", () => {
		const result = parseIdentifier("key:-999");
		expect(result.key).toBe("key");
		expect(result.identifier).toBe(-999);
	});

	test("handles $root:-1 as key with negative identifier", () => {
		const result = parseIdentifier("$root:-1");
		expect(result.key).toBe("$root");
		expect(result.identifier).toBe(-1);
	});

	test("handles key with multiple colons and negative identifier", () => {
		const result = parseIdentifier("some:key:-3");
		expect(result.key).toBe("some:key");
		expect(result.identifier).toBe(-3);
	});
});

// ─── extractExpressionIdentifier() ──────────────────────────────────────────

describe("extractExpressionIdentifier", () => {
	test("extracts identifier from single segment", () => {
		const result = extractExpressionIdentifier(["meetingId:1"]);
		expect(result.cleanSegments).toEqual(["meetingId"]);
		expect(result.identifier).toBe(1);
	});

	test("extracts identifier from multi-segment path (last segment)", () => {
		const result = extractExpressionIdentifier(["user", "name:1"]);
		expect(result.cleanSegments).toEqual(["user", "name"]);
		expect(result.identifier).toBe(1);
	});

	test("returns null identifier when no colon syntax", () => {
		const result = extractExpressionIdentifier(["meetingId"]);
		expect(result.cleanSegments).toEqual(["meetingId"]);
		expect(result.identifier).toBeNull();
	});

	test("returns null identifier for multi-segment without colon", () => {
		const result = extractExpressionIdentifier(["user", "name"]);
		expect(result.cleanSegments).toEqual(["user", "name"]);
		expect(result.identifier).toBeNull();
	});

	test("handles empty segments array", () => {
		const result = extractExpressionIdentifier([]);
		expect(result.cleanSegments).toEqual([]);
		expect(result.identifier).toBeNull();
	});

	test("identifier 0 is correctly extracted", () => {
		const result = extractExpressionIdentifier(["key:0"]);
		expect(result.cleanSegments).toEqual(["key"]);
		expect(result.identifier).toBe(0);
	});

	test("only the last segment is parsed for identifier", () => {
		// Even if an intermediate segment looks like "foo:1", only the last matters
		const result = extractExpressionIdentifier(["foo:1", "bar"]);
		expect(result.cleanSegments).toEqual(["foo:1", "bar"]);
		expect(result.identifier).toBeNull();
	});

	test("$root:N is correctly extracted", () => {
		const result = extractExpressionIdentifier(["$root:2"]);
		expect(result.cleanSegments).toEqual(["$root"]);
		expect(result.identifier).toBe(2);
	});

	test("extracts negative identifier from single segment", () => {
		const result = extractExpressionIdentifier(["meetingId:-1"]);
		expect(result.cleanSegments).toEqual(["meetingId"]);
		expect(result.identifier).toBe(-1);
	});

	test("extracts negative identifier from multi-segment path", () => {
		const result = extractExpressionIdentifier(["user", "name:-1"]);
		expect(result.cleanSegments).toEqual(["user", "name"]);
		expect(result.identifier).toBe(-1);
	});

	test("$root:-1 is correctly extracted", () => {
		const result = extractExpressionIdentifier(["$root:-1"]);
		expect(result.cleanSegments).toEqual(["$root"]);
		expect(result.identifier).toBe(-1);
	});
});
