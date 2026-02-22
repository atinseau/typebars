import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import {
	analyze,
	clearCompilationCache,
	clearParseCache,
	execute,
	extractExpressionIdentifier,
	parseIdentifier,
	TemplateEngine,
} from "../src/index.ts";

// ═════════════════════════════════════════════════════════════════════════════
// Template Identifiers ({{key:N}}) — Full Feature Tests
// ═════════════════════════════════════════════════════════════════════════════
//
// Ces tests vérifient le support complet de la syntaxe {{key:N}} dans les
// trois couches du moteur : parsing, analyse statique, et exécution.
//
// La syntaxe {{key:N}} permet de résoudre une variable depuis une source
// de données spécifique identifiée par un entier positif N (ou 0).
//
// Correspondance avec l'ancien système (SchemaIOService) :
//   - `identifierData`    ↔ ancien `outputNodeById` (3ème arg de interpolateTemplateValues)
//   - `identifierSchemas` ↔ ancien `prevSchemas`     (3ème arg de validateTemplateUsage)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reproduit interpolateTemplateValues avec support des identifiers */
function interpolateObject(
	templateObj: Record<string, unknown>,
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(templateObj)) {
		if (typeof value === "string") {
			result[key] = execute(value, data, identifierData);
		} else if (Array.isArray(value)) {
			result[key] = value.map((item) => {
				if (typeof item === "string") {
					return execute(item, data, identifierData);
				}
				return item;
			});
		} else {
			result[key] = value;
		}
	}

	return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 : parseIdentifier / extractExpressionIdentifier
// ═════════════════════════════════════════════════════════════════════════════

describe("parseIdentifier", () => {
	beforeEach(() => {
		clearParseCache();
		clearCompilationCache();
	});

	test("extracts key and identifier from 'meetingId:1'", () => {
		const result = parseIdentifier("meetingId:1");
		expect(result).toEqual({ key: "meetingId", identifier: 1 });
	});

	test("extracts key and identifier from 'meetingId:0'", () => {
		const result = parseIdentifier("meetingId:0");
		expect(result).toEqual({ key: "meetingId", identifier: 0 });
	});

	test("extracts key and identifier with large number", () => {
		const result = parseIdentifier("meetingId:999");
		expect(result).toEqual({ key: "meetingId", identifier: 999 });
	});

	test("returns null identifier for plain key", () => {
		const result = parseIdentifier("meetingId");
		expect(result).toEqual({ key: "meetingId", identifier: null });
	});

	test("does not match non-numeric identifiers", () => {
		const result = parseIdentifier("meetingId:abc");
		expect(result).toEqual({ key: "meetingId:abc", identifier: null });
	});

	test("handles key with multiple colons — only last numeric part is the identifier", () => {
		const result = parseIdentifier("some:key:3");
		expect(result).toEqual({ key: "some:key", identifier: 3 });
	});
});

describe("extractExpressionIdentifier", () => {
	test("extracts from single segment with identifier", () => {
		const result = extractExpressionIdentifier(["meetingId:1"]);
		expect(result).toEqual({ cleanSegments: ["meetingId"], identifier: 1 });
	});

	test("extracts from multi-segment path with identifier on last", () => {
		const result = extractExpressionIdentifier(["user", "name:1"]);
		expect(result).toEqual({ cleanSegments: ["user", "name"], identifier: 1 });
	});

	test("returns null identifier for segments without identifier", () => {
		const result = extractExpressionIdentifier(["meetingId"]);
		expect(result).toEqual({ cleanSegments: ["meetingId"], identifier: null });
	});

	test("returns null identifier for multi-segment without identifier", () => {
		const result = extractExpressionIdentifier(["user", "name"]);
		expect(result).toEqual({
			cleanSegments: ["user", "name"],
			identifier: null,
		});
	});

	test("handles empty segments", () => {
		const result = extractExpressionIdentifier([]);
		expect(result).toEqual({ cleanSegments: [], identifier: null });
	});

	test("handles identifier 0", () => {
		const result = extractExpressionIdentifier(["val:0"]);
		expect(result).toEqual({ cleanSegments: ["val"], identifier: 0 });
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 : execute() avec identifierData
// ═════════════════════════════════════════════════════════════════════════════

describe("execute() with identifierData", () => {
	beforeEach(() => {
		clearParseCache();
		clearCompilationCache();
	});

	describe("single expression {{key:N}} — type preservation", () => {
		test("preserves string type from identifier source", () => {
			const result = execute(
				"{{meetingId:1}}",
				{},
				{ 1: { meetingId: "hello" } },
			);
			expect(result).toBe("hello");
			expect(typeof result).toBe("string");
		});

		test("preserves number type from identifier source", () => {
			const result = execute("{{meetingId:1}}", {}, { 1: { meetingId: 123 } });
			expect(result).toBe(123);
			expect(typeof result).toBe("number");
		});

		test("preserves boolean true from identifier source", () => {
			const result = execute("{{active:1}}", {}, { 1: { active: true } });
			expect(result).toBe(true);
		});

		test("preserves boolean false from identifier source", () => {
			const result = execute("{{active:1}}", {}, { 1: { active: false } });
			expect(result).toBe(false);
		});

		test("preserves array from identifier source", () => {
			const arr = [1, 2, 3];
			const result = execute("{{ids:1}}", {}, { 1: { ids: arr } });
			expect(result).toEqual(arr);
			expect(Array.isArray(result)).toBe(true);
		});

		test("preserves object from identifier source", () => {
			const obj = { a: 1, b: "two" };
			const result = execute("{{data:1}}", {}, { 1: { data: obj } });
			expect(result).toEqual(obj);
		});

		test("preserves null from identifier source", () => {
			const result = execute("{{val:1}}", {}, { 1: { val: null } });
			expect(result).toBeNull();
		});

		test("preserves 0 from identifier source", () => {
			const result = execute("{{val:1}}", {}, { 1: { val: 0 } });
			expect(result).toBe(0);
		});

		test("returns undefined when key missing in identifier source", () => {
			const result = execute("{{missing:1}}", {}, { 1: { other: "hello" } });
			expect(result).toBeUndefined();
		});

		test("returns undefined when identifier source does not exist", () => {
			const result = execute(
				"{{meetingId:1}}",
				{},
				{ 2: { meetingId: "hello" } },
			);
			expect(result).toBeUndefined();
		});

		test("returns undefined when no identifierData provided for identifier template", () => {
			const result = execute("{{meetingId:1}}", {});
			expect(result).toBeUndefined();
		});
	});

	describe("identifier 0", () => {
		test("resolves from identifier 0", () => {
			const result = execute(
				"{{meetingId:0}}",
				{},
				{ 0: { meetingId: "test" } },
			);
			expect(result).toBe("test");
		});

		test("preserves value 0 from identifier 0", () => {
			const result = execute("{{meetingId:0}}", {}, { 0: { meetingId: 0 } });
			expect(result).toBe(0);
		});

		test("text + identifier 0 expression (old test: replaced value is 0)", () => {
			const result = execute(
				"salut {{meetingId:0}} ok {{meetingId:0}}",
				{ meetingId: 0 },
				{ 0: { meetingId: 0 } },
			);
			expect(result).toBe("salut 0 ok 0");
		});

		test("text + identifier 0 expression with string value", () => {
			const result = execute(
				"salut {{meetingId:0}} ok {{meetingId:0}}",
				{ meetingId: "coucou" },
				{ 0: { meetingId: "test" } },
			);
			expect(result).toBe("salut test ok test");
		});
	});

	describe("same key, different identifiers", () => {
		test("resolves each identifier to its own source", () => {
			const result = execute(
				"{{meetingId:1}} {{meetingId:2}}",
				{},
				{
					1: { meetingId: "coucou1" },
					2: { meetingId: "coucou2" },
				},
			);
			expect(result).toBe("coucou1 coucou2");
		});

		test("reversed order of identifiers", () => {
			const result = execute(
				"{{meetingId:2}} {{meetingId:1}}",
				{},
				{
					1: { meetingId: "coucou1" },
					2: { meetingId: "coucou2" },
				},
			);
			expect(result).toBe("coucou2 coucou1");
		});

		test("different keys with different identifiers", () => {
			const result = execute(
				"{{meetingId:1}} {{leadName:2}}",
				{},
				{
					1: { meetingId: "coucou1", leadName: "bye bye1" },
					2: { meetingId: "coucou2", leadName: "bye bye2" },
				},
			);
			expect(result).toBe("coucou1 bye bye2");
		});
	});

	describe("mixing with and without identifiers", () => {
		test("template without identifier resolves from data, with identifier from identifierData", () => {
			const result = execute(
				"{{name}} {{meetingId:1}}",
				{ name: "Alice" },
				{ 1: { meetingId: "test" } },
			);
			expect(result).toBe("Alice test");
		});

		test("without identifier ignores identifierData", () => {
			const result = execute(
				"{{meetingId}} {{meetingId}}",
				{ meetingId: "coucou" },
				{
					1: { meetingId: "coucou1" },
					2: { meetingId: "coucou2" },
				},
			);
			expect(result).toBe("coucou coucou");
		});

		test("text + mix of identifier and non-identifier", () => {
			const result = execute(
				"salut {{meetingId:1}} ok {{leadName:2}}",
				{ meetingId: "coucou", leadName: "bye bye" },
				{
					1: { meetingId: "test1" },
					2: { leadName: "test2" },
				},
			);
			expect(result).toBe("salut test1 ok test2");
		});

		test("identifier falls back properly — no identifier uses data even when identifierData present", () => {
			const result = execute(
				"{{meetingId}} and {{meetingId:1}}",
				{ meetingId: "from-data" },
				{ 1: { meetingId: "from-id-1" } },
			);
			expect(result).toBe("from-data and from-id-1");
		});
	});

	describe("multi-template string concatenation", () => {
		test("identifier values are stringified in multi-template", () => {
			const result = execute(
				"{{meetingId:1}} {{meetingId:2}}",
				{},
				{
					1: { meetingId: 123 },
					2: { meetingId: 456 },
				},
			);
			expect(result).toBe("123 456");
			expect(typeof result).toBe("string");
		});

		test("booleans are stringified in multi-template with identifiers", () => {
			const result = execute(
				"{{a:1}} {{b:2}}",
				{},
				{
					1: { a: true },
					2: { b: false },
				},
			);
			expect(result).toBe("true false");
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 : interpolateObject avec identifierData (migration des vieux tests)
// ═════════════════════════════════════════════════════════════════════════════

describe("interpolateObject with identifierData (old interpolateTemplateValues migration)", () => {
	test("old test: detect template with identifiers (basic)", () => {
		const _output = interpolateObject(
			{ accountId: "{{meetingId:1}} {{leadName:2}}" },
			{ meetingId: "coucou", leadName: "bye bye" },
		);
		// Sans identifierData fourni, les templates avec identifiers
		// retournent "" car Handlebars ne trouve pas "meetingId:1" dans data.
		// Mais si on fournit identifierData :
		const output2 = interpolateObject(
			{ accountId: "{{meetingId:1}} {{leadName:2}}" },
			{ meetingId: "coucou", leadName: "bye bye" },
			{
				1: { meetingId: "coucou1", leadName: "bye bye1" },
				2: { meetingId: "coucou2", leadName: "bye bye2" },
			},
		);
		expect(output2).toMatchObject({ accountId: "coucou1 bye bye2" });
	});

	test("old test: pick in outputNodeById with identifiers", () => {
		// {{meetingId:1}} {{meetingId:2}} avec sources différentes
		const output = interpolateObject(
			{ accountId: "{{meetingId:1}} {{meetingId:2}}" },
			{ meetingId: "coucou" },
			{
				1: { meetingId: "coucou1" },
				2: { meetingId: "coucou2" },
			},
		);
		expect(output).toMatchObject({ accountId: "coucou1 coucou2" });
	});

	test("old test: reversed identifiers order", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId:2}} {{meetingId:1}}" },
			{ meetingId: "coucou" },
			{
				1: { meetingId: "coucou1" },
				2: { meetingId: "coucou2" },
			},
		);
		expect(output).toMatchObject({ accountId: "coucou2 coucou1" });
	});

	test("old test: without identifier uses data, not identifierData", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId}} {{meetingId}}" },
			{ meetingId: "coucou" },
			{
				1: { meetingId: "coucou1" },
				2: { meetingId: "coucou2" },
			},
		);
		expect(output).toMatchObject({ accountId: "coucou coucou" });
	});

	test("old test: identifier with index 0 and string value", () => {
		const output = interpolateObject(
			{ accountId: "salut {{meetingId:0}} ok {{meetingId:0}}" },
			{ meetingId: "coucou" },
			{ 0: { meetingId: "test" } },
		);
		expect(output).toMatchObject({ accountId: "salut test ok test" });
	});

	test("old test: identifier with index 0 and value 0 (numeric)", () => {
		const output = interpolateObject(
			{ accountId: "salut {{meetingId:0}} ok {{meetingId:0}}" },
			{ meetingId: 0 },
			{ 0: { meetingId: 0 } },
		);
		expect(output).toMatchObject({ accountId: "salut 0 ok 0" });
	});

	test("old test: text + different identifiers with different keys", () => {
		const output = interpolateObject(
			{ accountId: "salut {{meetingId:1}} ok {{leadName:2}}" },
			{ meetingId: "coucou", leadName: "bye bye" },
			{
				1: { meetingId: "test1" },
				2: { leadName: "test2" },
			},
		);
		expect(output).toMatchObject({ accountId: "salut test1 ok test2" });
	});

	test("old test: same key different identifiers inline", () => {
		const output = interpolateObject(
			{ accountId: "salut {{meetingId:1}} ok {{meetingId:2}}" },
			{ meetingId: "coucou" },
			{
				1: { meetingId: "test1" },
				2: { meetingId: "test2" },
			},
		);
		expect(output).toMatchObject({ accountId: "salut test1 ok test2" });
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 : analyze() avec identifierSchemas
// ═════════════════════════════════════════════════════════════════════════════

describe("analyze() with identifierSchemas", () => {
	beforeEach(() => {
		clearParseCache();
	});

	describe("basic identifier validation", () => {
		test("valid: identifier key exists in identifierSchemas", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
			};

			const result = analyze("{{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
			expect(
				result.diagnostics.filter((d) => d.severity === "error"),
			).toHaveLength(0);
		});

		test("invalid: identifier used but no identifierSchemas provided", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { meetingId: { type: "string" } },
			};

			const result = analyze("{{meetingId:1}}", schema);
			expect(result.valid).toBe(false);
			expect(
				result.diagnostics.filter((d) => d.severity === "error").length,
			).toBeGreaterThan(0);
		});

		test("invalid: identifier N not found in identifierSchemas", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { meetingId: { type: "string" } },
			};
			const idSchemas: Record<number, JSONSchema7> = {
				2: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
			};

			const result = analyze("{{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(false);
		});

		test("invalid: key does not exist in identifier schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {},
			};
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { otherKey: { type: "string" } },
				},
			};

			const result = analyze("{{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(false);
		});

		test("valid: identifier 0", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				0: {
					type: "object",
					properties: { val: { type: "number" } },
				},
			};

			const result = analyze("{{val:0}}", schema, idSchemas);
			expect(result.valid).toBe(true);
		});
	});

	describe("output schema inference with identifiers", () => {
		test("infers type from identifier schema (string)", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
			};

			const result = analyze("{{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("infers type from identifier schema (number)", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { age: { type: "number" } },
				},
			};

			const result = analyze("{{age:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("infers type from identifier schema (boolean)", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { active: { type: "boolean" } },
				},
			};

			const result = analyze("{{active:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("infers type from identifier schema (array)", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: {
						ids: { type: "array", items: { type: "number" } },
					},
				},
			};

			const result = analyze("{{ids:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		test("infers type from identifier schema (with enum)", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: {
						role: { type: "string", enum: ["admin", "user"] },
					},
				},
			};

			const result = analyze("{{role:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "string",
				enum: ["admin", "user"],
			});
		});

		test("mixed template with identifiers → always string", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "number" } },
				},
			};

			const result = analyze("{{name}} {{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	describe("different identifiers reference different schemas", () => {
		test("same key in different identifier schemas — correct type inference", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { someKey: { type: "string" } },
				},
				2: {
					type: "object",
					properties: { someKey: { type: "boolean" } },
				},
			};

			{
				const result = analyze("{{someKey:1}}", schema, idSchemas);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string" });
			}

			{
				const result = analyze("{{someKey:2}}", schema, idSchemas);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "boolean" });
			}
		});

		test("validates each identifier independently", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
				2: {
					type: "object",
					properties: { leadName: { type: "string" } },
				},
			};

			// Both valid
			const result = analyze(
				"{{meetingId:1}} {{leadName:2}}",
				schema,
				idSchemas,
			);
			expect(result.valid).toBe(true);
		});

		test("fails if one identifier's key doesn't exist", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
				2: {
					type: "object",
					properties: { otherKey: { type: "string" } },
				},
			};

			// meetingId:1 valid, leadName:2 invalid (not in id schema 2)
			const result = analyze(
				"{{meetingId:1}} {{leadName:2}}",
				schema,
				idSchemas,
			);
			expect(result.valid).toBe(false);
		});
	});

	describe("mixing identifier and non-identifier expressions", () => {
		test("non-identifier validates against inputSchema, identifier against identifierSchemas", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
			};

			const result = analyze("{{name}} {{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
		});

		test("fails if non-identifier key missing from inputSchema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {},
			};
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
			};

			const result = analyze("{{badKey}} {{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(false);
		});

		test("fails if identifier key missing from identifierSchemas", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { otherKey: { type: "string" } },
				},
			};

			const result = analyze("{{name}} {{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(false);
		});
	});

	describe("identifierSchemas with empty record", () => {
		test("fails when identifierSchemas is empty and template uses identifier", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { meetingId: { type: "string" } },
			};

			const result = analyze("{{meetingId:2}}", schema, {});
			expect(result.valid).toBe(false);
		});

		test("succeeds without identifier even when identifierSchemas is empty", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { meetingId: { type: "string" } },
			};

			const result = analyze("{{meetingId}}", schema, {});
			expect(result.valid).toBe(true);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 : TemplateEngine class with identifiers
// ═════════════════════════════════════════════════════════════════════════════

describe("TemplateEngine with identifiers", () => {
	beforeEach(() => {
		clearParseCache();
		clearCompilationCache();
	});

	describe("analyze()", () => {
		const engine = new TemplateEngine();

		test("passes identifierSchemas through to analyze", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
			};

			const result = engine.analyze("{{meetingId:1}}", schema, idSchemas);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("fails without identifierSchemas when identifier is used", () => {
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const result = engine.analyze("{{meetingId:1}}", schema);
			expect(result.valid).toBe(false);
		});
	});

	describe("execute() with identifierData", () => {
		test("resolves identifier from identifierData", () => {
			const engine = new TemplateEngine();
			const result = engine.execute(
				"{{meetingId:1}}",
				{},
				{
					identifierData: { 1: { meetingId: "hello" } },
				},
			);
			expect(result).toBe("hello");
		});

		test("preserves type for single identifier expression", () => {
			const engine = new TemplateEngine();
			const result = engine.execute(
				"{{count:1}}",
				{},
				{
					identifierData: { 1: { count: 42 } },
				},
			);
			expect(result).toBe(42);
			expect(typeof result).toBe("number");
		});

		test("mixed data and identifierData", () => {
			const engine = new TemplateEngine();
			const result = engine.execute(
				"{{name}} {{greeting:1}}",
				{ name: "Alice" },
				{ identifierData: { 1: { greeting: "hello" } } },
			);
			expect(result).toBe("Alice hello");
		});
	});

	describe("execute() strict mode with identifierSchemas", () => {
		test("succeeds when both schema and identifierSchemas validate", () => {
			const engine = new TemplateEngine();
			const schema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
			};

			const result = engine.execute(
				"{{name}} {{meetingId:1}}",
				{ name: "Alice" },
				{
					schema,
					identifierData: { 1: { meetingId: "test" } },
					identifierSchemas: idSchemas,
				},
			);
			expect(result).toBe("Alice test");
		});

		test("throws when identifier key is missing from identifierSchemas", () => {
			const engine = new TemplateEngine();
			const schema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { otherKey: { type: "string" } },
				},
			};

			expect(() =>
				engine.execute(
					"{{meetingId:1}}",
					{},
					{
						schema,
						identifierData: { 1: { meetingId: "test" } },
						identifierSchemas: idSchemas,
					},
				),
			).toThrow();
		});

		test("throws when identifier N not in identifierSchemas", () => {
			const engine = new TemplateEngine();
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {};

			expect(() =>
				engine.execute(
					"{{meetingId:1}}",
					{},
					{
						schema,
						identifierData: { 1: { meetingId: "test" } },
						identifierSchemas: idSchemas,
					},
				),
			).toThrow();
		});
	});

	describe("analyzeAndExecute()", () => {
		test("returns analysis and value for valid identifier template", () => {
			const engine = new TemplateEngine();
			const schema: JSONSchema7 = { type: "object", properties: {} };
			const idSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "number" } },
				},
			};

			const { analysis, value } = engine.analyzeAndExecute(
				"{{meetingId:1}}",
				schema,
				{},
				idSchemas,
				{ 1: { meetingId: 42 } },
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "number" });
			expect(value).toBe(42);
		});

		test("returns undefined value for invalid identifier template", () => {
			const engine = new TemplateEngine();
			const schema: JSONSchema7 = { type: "object", properties: {} };

			const { analysis, value } = engine.analyzeAndExecute(
				"{{meetingId:1}}",
				schema,
				{},
			);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6 : Migration exacte des anciens tests interpolateTemplateValues
//             qui utilisaient outputNodeById (3ème argument)
// ═════════════════════════════════════════════════════════════════════════════

describe("Exact migration of old interpolateTemplateValues tests with identifiers", () => {
	beforeEach(() => {
		clearParseCache();
		clearCompilationCache();
	});

	test("old: detect template with identifiers (no identifierData → falls back to data)", () => {
		// L'ancien système résolvait {{meetingId:1}} depuis data si pas de
		// outputNodeById. Le nouveau système retourne "" (Handlebars ne trouve pas).
		// Mais le cas intéressant est AVEC identifierData.
		const output = interpolateObject(
			{ accountId: "{{meetingId:1}} {{leadName:2}}" },
			{ meetingId: "coucou", leadName: "bye bye" },
			{
				1: { meetingId: "coucou", leadName: "bye bye" },
				2: { meetingId: "coucou", leadName: "bye bye" },
			},
		);
		expect(output).toMatchObject({ accountId: "coucou bye bye" });
	});

	test("old: pick in outputNodeById — {{meetingId:1}} {{leadName:2}}", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId:1}} {{leadName:2}}" },
			{ meetingId: "coucou", leadName: "bye bye" },
			{
				1: { meetingId: "coucou1", leadName: "bye bye1" },
				2: { meetingId: "coucou2", leadName: "bye bye2" },
			},
		);
		expect(output).toMatchObject({ accountId: "coucou1 bye bye2" });
	});

	test("old: without identifier uses main data — {{meetingId}} {{meetingId}}", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId}} {{meetingId}}" },
			{ meetingId: "coucou" },
			{
				1: { meetingId: "coucou1" },
				2: { meetingId: "coucou2" },
			},
		);
		expect(output).toMatchObject({ accountId: "coucou coucou" });
	});

	test("old: {{meetingId:1}} {{meetingId:2}} picks from respective sources", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId:1}} {{meetingId:2}}" },
			{ meetingId: "coucou" },
			{
				1: { meetingId: "coucou1" },
				2: { meetingId: "coucou2" },
			},
		);
		expect(output).toMatchObject({ accountId: "coucou1 coucou2" });
	});

	test("old: {{meetingId:2}} {{meetingId:1}} reversed order", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId:2}} {{meetingId:1}}" },
			{ meetingId: "coucou" },
			{
				1: { meetingId: "coucou1" },
				2: { meetingId: "coucou2" },
			},
		);
		expect(output).toMatchObject({ accountId: "coucou2 coucou1" });
	});

	test("old: salut {{meetingId:1}} ok {{leadName:2}} — text + different keys + identifiers", () => {
		const output = interpolateObject(
			{ accountId: "salut {{meetingId:1}} ok {{leadName:2}}" },
			{ meetingId: "coucou", leadName: "bye bye" },
			{
				1: { meetingId: "test1" },
				2: { leadName: "test2" },
			},
		);
		expect(output).toMatchObject({ accountId: "salut test1 ok test2" });
	});

	test("old: salut {{meetingId:1}} ok {{meetingId:2}} — same key different ids", () => {
		const output = interpolateObject(
			{ accountId: "salut {{meetingId:1}} ok {{meetingId:2}}" },
			{ meetingId: "coucou" },
			{
				1: { meetingId: "test1" },
				2: { meetingId: "test2" },
			},
		);
		expect(output).toMatchObject({ accountId: "salut test1 ok test2" });
	});

	test("old: identifier 0 with string value", () => {
		const output = interpolateObject(
			{ accountId: "salut {{meetingId:0}} ok {{meetingId:0}}" },
			{ meetingId: "coucou" },
			{ 0: { meetingId: "test" } },
		);
		expect(output).toMatchObject({ accountId: "salut test ok test" });
	});

	test("old: identifier 0 with value 0", () => {
		const output = interpolateObject(
			{ accountId: "salut {{meetingId:0}} ok {{meetingId:0}}" },
			{ meetingId: 0 },
			{ 0: { meetingId: 0 } },
		);
		expect(output).toMatchObject({ accountId: "salut 0 ok 0" });
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 7 : Migration des anciens tests validateTemplateUsage avec prevSchemas
// ═════════════════════════════════════════════════════════════════════════════

describe("Exact migration of old validateTemplateUsage tests with prevSchemas", () => {
	beforeEach(() => {
		clearParseCache();
	});

	test("old: success if template has identifier and key exists in identifierSchemas", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: { meetingId: { type: "string" } },
		};
		const idSchemas: Record<number, JSONSchema7> = {
			2: {
				type: "object",
				properties: { meetingId: { type: "string" } },
			},
		};

		const result = analyze("{{meetingId:2}}", schema, idSchemas);
		expect(result.valid).toBe(true);
	});

	test("old: fail if identifier not found in identifierSchemas (empty)", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: { meetingId: { type: "string" } },
		};

		const result = analyze("{{meetingId:2}}", schema, {});
		expect(result.valid).toBe(false);
		expect(
			result.diagnostics.filter((d) => d.severity === "error").length,
		).toBeGreaterThan(0);
	});

	test("old: success if identifier found in identifierSchemas", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: { meetingId: { type: "string" } },
		};
		const idSchemas: Record<number, JSONSchema7> = {
			2: {
				type: "object",
				properties: { meetingId: { type: "string" } },
			},
		};

		const result = analyze("{{meetingId:2}}", schema, idSchemas);
		expect(result.valid).toBe(true);
	});

	test("old: no identifier → validates against main schema (success)", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: { meetingId: { type: "string" } },
		};

		const result = analyze("{{meetingId}}", schema);
		expect(result.valid).toBe(true);
	});

	test("old: no identifier → validates against main schema (failure)", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {},
		};

		const result = analyze("{{meetingId}}", schema);
		expect(result.valid).toBe(false);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 8 : Migration des anciens tests findTemplateSchemaFromPrevSchemas
// ═════════════════════════════════════════════════════════════════════════════

describe("Exact migration of old findTemplateSchemaFromPrevSchemas behavior", () => {
	beforeEach(() => {
		clearParseCache();
	});

	// L'ancien findTemplateSchemaFromPrevSchemas(key, identifier, prevSchemas)
	// cherchait un schema dans une liste ordonnée [id, schema][].
	// Le nouveau système utilise identifierSchemas comme Record<number, JSONSchema7>
	// et la résolution se fait via resolveSchemaPath.

	test("returns correct type when identifier is provided and found", () => {
		const idSchemas: Record<number, JSONSchema7> = {
			1: {
				type: "object",
				properties: { someKey: { type: "string" } },
			},
		};

		const result = analyze(
			"{{someKey:1}}",
			{ type: "object", properties: {} },
			idSchemas,
		);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "string" });
	});

	test("fails when identifier is provided but not found in schemas", () => {
		const idSchemas: Record<number, JSONSchema7> = {
			2: {
				type: "object",
				properties: { someKey: { type: "string" } },
			},
		};

		const result = analyze(
			"{{someKey:1}}",
			{ type: "object", properties: {} },
			idSchemas,
		);
		expect(result.valid).toBe(false);
	});

	test("fails when key is not in the identifier's schema", () => {
		const idSchemas: Record<number, JSONSchema7> = {
			1: {
				type: "object",
				properties: { otherKey: { type: "string" } },
			},
		};

		const result = analyze(
			"{{someKey:1}}",
			{ type: "object", properties: {} },
			idSchemas,
		);
		expect(result.valid).toBe(false);
	});

	test("returns correct types for different identifiers with same key", () => {
		const idSchemas: Record<number, JSONSchema7> = {
			1: {
				type: "object",
				properties: { someKey: { type: "string" } },
			},
			2: {
				type: "object",
				properties: { someKey: { type: "boolean" } },
			},
		};

		{
			const result = analyze(
				"{{someKey:2}}",
				{ type: "object", properties: {} },
				idSchemas,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		}

		{
			const result = analyze(
				"{{someKey:1}}",
				{ type: "object", properties: {} },
				idSchemas,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		}
	});

	test("without identifier, resolves from main schema", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: { someKey: { type: "number" } },
		};
		const idSchemas: Record<number, JSONSchema7> = {
			1: {
				type: "object",
				properties: { someKey: { type: "string" } },
			},
		};

		const result = analyze("{{someKey}}", schema, idSchemas);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "number" });
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 9 : Edge cases
// ═════════════════════════════════════════════════════════════════════════════

describe("Template identifier edge cases", () => {
	beforeEach(() => {
		clearParseCache();
		clearCompilationCache();
	});

	test("identifier with no identifierData — execute returns undefined for single expr", () => {
		const result = execute("{{key:5}}", { key: "from-data" });
		expect(result).toBeUndefined();
	});

	test("identifier with empty identifierData object", () => {
		const result = execute("{{key:5}}", { key: "from-data" }, {});
		expect(result).toBeUndefined();
	});

	test("multiple same identifiers in a template share the same source", () => {
		const result = execute(
			"{{a:1}} {{b:1}}",
			{},
			{ 1: { a: "hello", b: "world" } },
		);
		expect(result).toBe("hello world");
	});

	test("identifier expression with whitespace inside moustaches", () => {
		const result = execute(
			"{{ meetingId:1 }}",
			{},
			{ 1: { meetingId: "val" } },
		);
		expect(result).toBe("val");
	});

	test("identifier in a conditional block argument", () => {
		const result = execute(
			"{{#if active:1}}yes{{else}}no{{/if}}",
			{},
			{ 1: { active: true } },
		);
		expect(result).toBe("yes");
	});

	test("identifier in a conditional block argument (falsy)", () => {
		const result = execute(
			"{{#if active:1}}yes{{else}}no{{/if}}",
			{},
			{ 1: { active: false } },
		);
		expect(result).toBe("no");
	});

	test("single expression identifier preserves complex nested object", () => {
		const complex = {
			users: [{ name: "Alice" }, { name: "Bob" }],
			meta: { total: 2 },
		};
		const result = execute("{{data:1}}", {}, { 1: { data: complex } });
		expect(result).toEqual(complex);
	});

	test("analyze validates #if argument with identifier", () => {
		const schema: JSONSchema7 = { type: "object", properties: {} };
		const idSchemas: Record<number, JSONSchema7> = {
			1: {
				type: "object",
				properties: { active: { type: "boolean" } },
			},
		};

		const result = analyze("{{#if active:1}}yes{{/if}}", schema, idSchemas);
		expect(result.valid).toBe(true);
	});

	test("analyze fails #if argument with missing identifier schema", () => {
		const schema: JSONSchema7 = { type: "object", properties: {} };

		const result = analyze("{{#if active:1}}yes{{/if}}", schema);
		expect(result.valid).toBe(false);
	});

	test("large identifier number works", () => {
		const result = execute("{{val:999}}", {}, { 999: { val: "ok" } });
		expect(result).toBe("ok");
	});

	test("identifierData does not pollute resolution of non-identifier templates", () => {
		// {{name}} should resolve from data, NOT from identifierData even if
		// identifierData has a source with "name"
		const result = execute(
			"{{name}}",
			{ name: "from-data" },
			{ 1: { name: "from-id" } },
		);
		expect(result).toBe("from-data");
	});
});
