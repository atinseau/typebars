import { describe, expect, test } from "bun:test";
import { TemplateParseError } from "../src/errors";
import { parse } from "../src/parser";

describe("parser", () => {
	test("parse returns a valid AST for a simple template", () => {
		const ast = parse("Hello {{name}}");
		expect(ast).toBeDefined();
		expect(ast.type).toBe("Program");
		expect(ast.body.length).toBe(2); // ContentStatement + MustacheStatement
	});

	test("parse returns an AST for a single expression", () => {
		const ast = parse("{{name}}");
		expect(ast.body.length).toBe(1);
		expect(ast.body[0]?.type).toBe("MustacheStatement");
	});

	test("parse handles #if blocks", () => {
		const ast = parse("{{#if active}}yes{{/if}}");
		expect(ast.body.length).toBe(1);
		expect(ast.body[0]?.type).toBe("BlockStatement");
	});

	test("parse handles #each blocks", () => {
		const ast = parse("{{#each items}}{{this}}{{/each}}");
		expect(ast.body[0]?.type).toBe("BlockStatement");
	});

	test("parse throws TemplateParseError for an invalid template", () => {
		expect(() => parse("{{#if x}}oops{{/each}}")).toThrow(TemplateParseError);
	});

	test("parse throws TemplateParseError for an unclosed block", () => {
		expect(() => parse("{{#if x}}")).toThrow(TemplateParseError);
	});

	test("parse accepts comments", () => {
		const ast = parse("{{!-- a comment --}}Hello");
		// The comment + the text
		expect(ast.body.length).toBeGreaterThanOrEqual(1);
	});

	test("parse handles plain text without expressions", () => {
		const ast = parse("Just plain text");
		expect(ast.body.length).toBe(1);
		expect(ast.body[0]?.type).toBe("ContentStatement");
	});
});
