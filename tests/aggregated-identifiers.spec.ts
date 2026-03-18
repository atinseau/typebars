import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer.ts";
import { clearCompilationCache, execute } from "../src/executor.ts";
import { Typebars } from "../src/typebars.ts";

// ═════════════════════════════════════════════════════════════════════════════
// Aggregated Identifier Data — Full Feature Tests
// ═════════════════════════════════════════════════════════════════════════════
//
// These tests verify the support for aggregated (array) identifier data,
// where `identifierData[N]` maps to an array of objects instead of a single
// object. This is the key building block for consuming multi-versioned
// workflow node outputs at a merge point.
//
// When identifierData[N] is an array:
// - `{{key:N}}`    → extracts `key` from each element → produces an array
// - `{{$root:N}}`  → returns the entire array of objects
//
// When identifierSchemas[N] is an array schema:
// - `{{key:N}}`    → inferred as { type: "array", items: <property schema> }
// - `{{$root:N}}`  → returns the full array schema as-is
//
// NOTE: `($root:N)` CANNOT be used as a Handlebars sub-expression argument
// (e.g. `{{ map ($root:4) "key" }}`), because Handlebars parses sub-expressions
// as helper calls, not data paths. The `{{key:N}}` direct extraction syntax
// is the primary way to consume aggregated data.

// ─── Fixtures ────────────────────────────────────────────────────────────────

const aggregatedData: Record<string, unknown>[] = [
	{ accountId: "A", amount: 100, active: true },
	{ accountId: "B", amount: 200, active: false },
	{ accountId: "C", amount: 300, active: true },
];

const aggregatedSchema: JSONSchema7 = {
	type: "array",
	items: {
		type: "object",
		properties: {
			accountId: { type: "string" },
			amount: { type: "number" },
			active: { type: "boolean" },
		},
		required: ["accountId", "amount", "active"],
	},
};

const scalarData = { seqOutput: "hello", count: 42 };
const scalarSchema: JSONSchema7 = {
	type: "object",
	properties: {
		seqOutput: { type: "string" },
		count: { type: "number" },
	},
	required: ["seqOutput", "count"],
};

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 : Execution — standalone execute()
// ═════════════════════════════════════════════════════════════════════════════

describe("Aggregated identifiers — execute()", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	// ─── Basic property extraction ───────────────────────────────────────

	describe("basic property extraction from aggregated data", () => {
		test("{{accountId:4}} extracts string property from each element → string[]", () => {
			const result = execute("{{accountId:4}}", {}, { 4: aggregatedData });
			expect(result).toEqual(["A", "B", "C"]);
		});

		test("{{amount:4}} extracts number property from each element → number[]", () => {
			const result = execute("{{amount:4}}", {}, { 4: aggregatedData });
			expect(result).toEqual([100, 200, 300]);
		});

		test("{{active:4}} extracts boolean property from each element → boolean[]", () => {
			const result = execute("{{active:4}}", {}, { 4: aggregatedData });
			expect(result).toEqual([true, false, true]);
		});

		test("extracts property that doesn't exist in some items → filters out undefined", () => {
			const data = [
				{ accountId: "A", extra: "x" },
				{ accountId: "B" },
				{ accountId: "C", extra: "z" },
			];
			const result = execute("{{extra:4}}", {}, { 4: data });
			expect(result).toEqual(["x", "z"]);
		});

		test("extracts property that doesn't exist in any item → empty array", () => {
			const result = execute("{{nonexistent:4}}", {}, { 4: aggregatedData });
			expect(result).toEqual([]);
		});
	});

	// ─── $root access ────────────────────────────────────────────────────

	describe("$root with aggregated identifier", () => {
		test("{{$root:4}} returns the entire array of objects", () => {
			const result = execute("{{$root:4}}", {}, { 4: aggregatedData });
			expect(result).toEqual(aggregatedData);
		});

		test("{{$root:4}} returns empty array when identifier data is []", () => {
			const result = execute("{{$root:4}}", {}, { 4: [] });
			expect(result).toEqual([]);
		});
	});

	// ─── Mixed scalar and aggregated identifiers ─────────────────────────

	describe("mixing scalar and aggregated identifiers", () => {
		test("scalar identifier still works alongside aggregated", () => {
			const result = execute(
				"{{seqOutput:2}}",
				{},
				{
					2: scalarData,
					4: aggregatedData,
				},
			);
			expect(result).toBe("hello");
		});

		test("aggregated identifier works alongside scalar", () => {
			const result = execute(
				"{{accountId:4}}",
				{},
				{
					2: scalarData,
					4: aggregatedData,
				},
			);
			expect(result).toEqual(["A", "B", "C"]);
		});

		test("mixed template: scalar + aggregated in same template → string concatenation", () => {
			const result = execute(
				"output: {{seqOutput:2}} ids: {{accountId:4}}",
				{},
				{
					2: scalarData,
					4: aggregatedData,
				},
			);
			expect(typeof result).toBe("string");
			// Arrays are stringified via String() → "A,B,C"
			expect(result).toBe("output: hello ids: A,B,C");
		});
	});

	// ─── Edge cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("single-element array → returns array with one element", () => {
			const result = execute(
				"{{accountId:4}}",
				{},
				{ 4: [{ accountId: "only" }] },
			);
			expect(result).toEqual(["only"]);
		});

		test("empty array → returns empty array", () => {
			const result = execute("{{accountId:4}}", {}, { 4: [] });
			expect(result).toEqual([]);
		});

		test("identifier 0 with aggregated data", () => {
			const result = execute(
				"{{accountId:0}}",
				{},
				{ 0: [{ accountId: "zero" }] },
			);
			expect(result).toEqual(["zero"]);
		});

		test("negative identifier with aggregated data", () => {
			const result = execute(
				"{{accountId:-1}}",
				{},
				{ [-1]: [{ accountId: "neg" }] },
			);
			expect(result).toEqual(["neg"]);
		});

		test("aggregated data with nested object property", () => {
			const data = [{ info: { city: "Paris" } }, { info: { city: "London" } }];
			const result = execute("{{info.city:4}}", {}, { 4: data });
			expect(result).toEqual(["Paris", "London"]);
		});

		test("non-existent identifier returns undefined (not affected by aggregated data elsewhere)", () => {
			const result = execute("{{accountId:99}}", {}, { 4: aggregatedData });
			expect(result).toBeUndefined();
		});

		test("aggregated with null values in items", () => {
			const data = [
				{ accountId: "A", value: null },
				{ accountId: "B", value: null },
			];
			const result = execute("{{value:4}}", {}, { 4: data });
			expect(result).toEqual([null, null]);
		});

		test("aggregated with mixed types in items", () => {
			const data = [{ value: "string" }, { value: 42 }, { value: true }];
			const result = execute("{{value:4}}", {}, { 4: data });
			expect(result).toEqual(["string", 42, true]);
		});
	});

	// ─── Interaction with main data ──────────────────────────────────────

	describe("interaction with main data context", () => {
		test("non-identifier expression resolves from data, not from aggregated identifierData", () => {
			const result = execute(
				"{{name}}",
				{ name: "Alice" },
				{ 4: aggregatedData },
			);
			expect(result).toBe("Alice");
		});

		test("non-identifier and aggregated identifier coexist", () => {
			const result = execute(
				"{{name}} {{accountId:4}}",
				{ name: "Alice" },
				{ 4: aggregatedData },
			);
			expect(result).toBe("Alice A,B,C");
		});
	});

	// ─── Fast-path execution ─────────────────────────────────────────────

	describe("fast-path execution (text + simple expressions)", () => {
		test("aggregated values are stringified in fast-path concatenation", () => {
			const result = execute("IDs: {{accountId:4}}", {}, { 4: aggregatedData });
			expect(typeof result).toBe("string");
			expect(result).toBe("IDs: A,B,C");
		});

		test("multiple aggregated expressions in fast-path", () => {
			const result = execute(
				"{{accountId:4}} / {{amount:4}}",
				{},
				{ 4: aggregatedData },
			);
			expect(result).toBe("A,B,C / 100,200,300");
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 : Static Analysis — standalone analyze()
// ═════════════════════════════════════════════════════════════════════════════

describe("Aggregated identifiers — analyze()", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	// ─── Output schema inference ─────────────────────────────────────────

	describe("output schema inference with array identifierSchemas", () => {
		test("{{accountId:4}} on array schema → { type: 'array', items: { type: 'string' } }", () => {
			const result = analyze(
				"{{accountId:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("{{amount:4}} on array schema → { type: 'array', items: { type: 'number' } }", () => {
			const result = analyze(
				"{{amount:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		test("{{active:4}} on array schema → { type: 'array', items: { type: 'boolean' } }", () => {
			const result = analyze(
				"{{active:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "boolean" },
			});
		});

		test("{{$root:4}} on array schema → returns full array schema", () => {
			const result = analyze(
				"{{$root:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual(aggregatedSchema);
		});
	});

	// ─── Error diagnostics ───────────────────────────────────────────────

	describe("error diagnostics for aggregated identifiers", () => {
		test("invalid: property does not exist in items schema → IDENTIFIER_PROPERTY_NOT_FOUND", () => {
			const result = analyze(
				"{{nonexistent:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(false);
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors.length).toBeGreaterThan(0);
			expect(errors[0]?.code).toBe("IDENTIFIER_PROPERTY_NOT_FOUND");
		});

		test("invalid: identifier not found → UNKNOWN_IDENTIFIER", () => {
			const result = analyze(
				"{{accountId:99}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(false);
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors[0]?.code).toBe("UNKNOWN_IDENTIFIER");
		});

		test("invalid: no identifierSchemas provided → MISSING_IDENTIFIER_SCHEMAS", () => {
			const result = analyze("{{accountId:4}}", {});
			expect(result.valid).toBe(false);
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors[0]?.code).toBe("MISSING_IDENTIFIER_SCHEMAS");
		});

		test("error message mentions 'items schema' for aggregated identifiers", () => {
			const result = analyze(
				"{{nonexistent:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors[0]?.message).toContain("items schema");
		});

		test("available properties are reported from items schema", () => {
			const result = analyze(
				"{{nonexistent:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors[0]?.details?.availableProperties).toContain("accountId");
			expect(errors[0]?.details?.availableProperties).toContain("amount");
			expect(errors[0]?.details?.availableProperties).toContain("active");
		});
	});

	// ─── Coexistence with scalar identifiers ─────────────────────────────

	describe("mixing scalar and aggregated identifier schemas", () => {
		test("scalar identifier infers scalar type, aggregated infers array type", () => {
			const idSchemas: Record<number, JSONSchema7> = {
				2: scalarSchema,
				4: aggregatedSchema,
			};

			const resultScalar = analyze(
				"{{seqOutput:2}}",
				{},
				{
					identifierSchemas: idSchemas,
				},
			);
			expect(resultScalar.valid).toBe(true);
			expect(resultScalar.outputSchema).toEqual({ type: "string" });

			const resultAggregated = analyze(
				"{{accountId:4}}",
				{},
				{
					identifierSchemas: idSchemas,
				},
			);
			expect(resultAggregated.valid).toBe(true);
			expect(resultAggregated.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("mixed template with scalar and aggregated → always string", () => {
			const idSchemas: Record<number, JSONSchema7> = {
				2: scalarSchema,
				4: aggregatedSchema,
			};

			const result = analyze(
				"output: {{seqOutput:2}} ids: {{accountId:4}}",
				{},
				{ identifierSchemas: idSchemas },
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	// ─── Nested property resolution ──────────────────────────────────────

	describe("nested property resolution in aggregated items", () => {
		test("resolves nested properties through items schema", () => {
			const nestedSchema: JSONSchema7 = {
				type: "array",
				items: {
					type: "object",
					properties: {
						info: {
							type: "object",
							properties: {
								city: { type: "string" },
							},
							required: ["city"],
						},
					},
					required: ["info"],
				},
			};

			const result = analyze(
				"{{info.city:4}}",
				{},
				{
					identifierSchemas: { 4: nestedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});
	});

	// ─── Array schema with $ref ──────────────────────────────────────────

	describe("array schema with $ref in items", () => {
		test("resolves $ref in items schema for aggregated identifier", () => {
			const schemaWithRef: JSONSchema7 = {
				type: "array",
				items: { $ref: "#/definitions/Account" },
				definitions: {
					Account: {
						type: "object",
						properties: {
							accountId: { type: "string" },
						},
						required: ["accountId"],
					},
				},
			};

			const inputSchema: JSONSchema7 = {
				type: "object",
				definitions: {
					Account: {
						type: "object",
						properties: {
							accountId: { type: "string" },
						},
						required: ["accountId"],
					},
				},
			};

			const result = analyze("{{accountId:4}}", inputSchema, {
				identifierSchemas: { 4: schemaWithRef },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});
	});

	// ─── Array without items ─────────────────────────────────────────────

	describe("array schema without items", () => {
		test("array schema without items → resolves within {} (empty schema)", () => {
			const schemaNoItems: JSONSchema7 = { type: "array" };

			// When there are no items, resolveArrayItems returns {}.
			// Resolving any property within {} succeeds with undefined,
			// which causes IDENTIFIER_PROPERTY_NOT_FOUND.
			const result = analyze(
				"{{accountId:4}}",
				{},
				{
					identifierSchemas: { 4: schemaNoItems },
				},
			);
			expect(result.valid).toBe(false);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 : Typebars engine integration
// ═════════════════════════════════════════════════════════════════════════════

describe("Aggregated identifiers — Typebars engine", () => {
	let tp: Typebars;

	beforeEach(() => {
		tp = new Typebars();
	});

	// ─── analyze() ───────────────────────────────────────────────────────

	describe("analyze()", () => {
		test("infers array type for aggregated identifier", () => {
			const result = tp.analyze(
				"{{accountId:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("infers full array schema for $root:N", () => {
			const result = tp.analyze(
				"{{$root:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual(aggregatedSchema);
		});
	});

	// ─── execute() ───────────────────────────────────────────────────────

	describe("execute()", () => {
		test("extracts property from aggregated identifierData", () => {
			const result = tp.execute(
				"{{accountId:4}}",
				{},
				{
					identifierData: { 4: aggregatedData },
				},
			);
			expect(result).toEqual(["A", "B", "C"]);
		});

		test("returns full array for $root:N", () => {
			const result = tp.execute(
				"{{$root:4}}",
				{},
				{
					identifierData: { 4: aggregatedData },
				},
			);
			expect(result).toEqual(aggregatedData);
		});

		test("scalar identifier still works", () => {
			const result = tp.execute(
				"{{seqOutput:2}}",
				{},
				{
					identifierData: { 2: scalarData, 4: aggregatedData },
				},
			);
			expect(result).toBe("hello");
		});
	});

	// ─── analyzeAndExecute() ─────────────────────────────────────────────

	describe("analyzeAndExecute()", () => {
		test("analyzes and executes aggregated identifier correctly", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				"{{accountId:4}}",
				{},
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
					identifierData: { 4: aggregatedData },
				},
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
			expect(value).toEqual(["A", "B", "C"]);
		});

		test("analyzeAndExecute with $root:N", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				"{{$root:4}}",
				{},
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
					identifierData: { 4: aggregatedData },
				},
			);
			expect(analysis.valid).toBe(true);
			expect(value).toEqual(aggregatedData);
		});

		test("analyzeAndExecute fails when property not in items schema", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				"{{nonexistent:4}}",
				{},
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
					identifierData: { 4: aggregatedData },
				},
			);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});
	});

	// ─── compile() ───────────────────────────────────────────────────────

	describe("compile()", () => {
		test("compiled template executes with aggregated identifierData", () => {
			const compiled = tp.compile("{{accountId:4}}");
			const result = compiled.execute(
				{},
				{
					identifierData: { 4: aggregatedData },
				},
			);
			expect(result).toEqual(["A", "B", "C"]);
		});

		test("compiled template analyzes with aggregated identifierSchemas", () => {
			const compiled = tp.compile("{{accountId:4}}");
			const result = compiled.analyze(
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 : Integration with map helper
// ═════════════════════════════════════════════════════════════════════════════
//
// NOTE: `($root:N)` CANNOT be used as a Handlebars sub-expression argument
// because Handlebars parses parenthesized expressions as helper calls, not
// data paths. `$root:4` is not a registered helper, so `(map ($root:4) "prop")`
// fails at runtime.
//
// The primary way to consume aggregated data is the direct `{{key:N}}` syntax,
// which extracts the property from each element automatically. The `map` helper
// can still be used on aggregated data when the array is made available through
// the regular data context.

describe("Aggregated identifiers — map helper integration", () => {
	let tp: Typebars;

	beforeEach(() => {
		tp = new Typebars();
	});

	// ─── map on aggregated data passed via regular data context ──────────

	describe("map on aggregated data in regular data context", () => {
		test("map works when aggregated array is passed in data (not identifierData)", () => {
			const result = tp.execute('{{ map accounts "accountId" }}', {
				accounts: aggregatedData,
			});
			expect(result).toEqual(["A", "B", "C"]);
		});

		test("map extracts number property from aggregated array in data", () => {
			const result = tp.execute('{{ map accounts "amount" }}', {
				accounts: aggregatedData,
			});
			expect(result).toEqual([100, 200, 300]);
		});

		test("map on empty array in data → empty array", () => {
			const result = tp.execute('{{ map accounts "accountId" }}', {
				accounts: [],
			});
			expect(result).toEqual([]);
		});
	});

	// ─── ($root:N) sub-expression limitation ─────────────────────────────

	describe("($root:N) sub-expression limitation", () => {
		test("($root:N) as sub-expression to map returns empty (Handlebars treats it as helper call)", () => {
			// This documents the known limitation: Handlebars parses ($root:4)
			// as a helper call, not a data path lookup. Since $root:4 is not
			// a registered helper, it returns undefined → map gets undefined → [].
			const result = tp.execute(
				'{{ map ($root:4) "accountId" }}',
				{},
				{ identifierData: { 4: aggregatedData } },
			);
			expect(result).toEqual([]);
		});
	});

	// ─── Direct extraction via {{key:N}} is the primary mechanism ────────

	describe("direct extraction via {{key:N}} (preferred over map)", () => {
		test("{{accountId:4}} extracts property directly — no map needed", () => {
			const result = tp.execute(
				"{{accountId:4}}",
				{},
				{
					identifierData: { 4: aggregatedData },
				},
			);
			expect(result).toEqual(["A", "B", "C"]);
		});

		test("analysis infers array type for {{key:N}} on aggregated schema", () => {
			const result = tp.analyze(
				"{{accountId:4}}",
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("analyzeAndExecute round-trip with direct extraction", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				"{{accountId:4}}",
				{},
				{},
				{
					identifierSchemas: { 4: aggregatedSchema },
					identifierData: { 4: aggregatedData },
				},
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
			expect(value).toEqual(["A", "B", "C"]);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 : Object and Array template inputs with aggregated identifiers
// ═════════════════════════════════════════════════════════════════════════════

describe("Aggregated identifiers — object/array template inputs", () => {
	let tp: Typebars;

	beforeEach(() => {
		tp = new Typebars();
	});

	describe("object template with aggregated identifiers", () => {
		test("resolves aggregated identifier within object template", () => {
			const result = tp.execute(
				{
					accountIds: "{{accountId:4}}",
					label: "{{seqOutput:2}}",
					count: 42,
				},
				{},
				{
					identifierData: {
						2: scalarData,
						4: aggregatedData,
					},
				},
			);
			expect(result).toEqual({
				accountIds: ["A", "B", "C"],
				label: "hello",
				count: 42,
			});
		});

		test("analyzes object template with mixed scalar and aggregated", () => {
			const result = tp.analyze(
				{
					accountIds: "{{accountId:4}}",
					label: "{{seqOutput:2}}",
				},
				{},
				{
					identifierSchemas: {
						2: scalarSchema,
						4: aggregatedSchema,
					},
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					accountIds: {
						type: "array",
						items: { type: "string" },
					},
					label: { type: "string" },
				},
				required: ["accountIds", "label"],
			});
		});
	});

	describe("array template with aggregated identifiers", () => {
		test("resolves aggregated identifier within array template", () => {
			const result = tp.execute(
				["{{accountId:4}}", "{{seqOutput:2}}", "static"],
				{},
				{
					identifierData: {
						2: scalarData,
						4: aggregatedData,
					},
				},
			);
			expect(result).toEqual([["A", "B", "C"], "hello", "static"]);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6 : Backward compatibility — scalar identifiers unchanged
// ═════════════════════════════════════════════════════════════════════════════

describe("Aggregated identifiers — backward compatibility", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	test("scalar identifierData still works exactly as before (string)", () => {
		const result = execute("{{meetingId:1}}", {}, { 1: { meetingId: "abc" } });
		expect(result).toBe("abc");
	});

	test("scalar identifierData still works exactly as before (number)", () => {
		const result = execute("{{count:1}}", {}, { 1: { count: 42 } });
		expect(result).toBe(42);
	});

	test("scalar identifierData still works exactly as before (boolean)", () => {
		const result = execute("{{active:1}}", {}, { 1: { active: true } });
		expect(result).toBe(true);
	});

	test("scalar identifierData still works exactly as before (null)", () => {
		const result = execute("{{value:1}}", {}, { 1: { value: null } });
		expect(result).toBeNull();
	});

	test("scalar identifierData with object value (not array of objects)", () => {
		const result = execute(
			"{{nested:1}}",
			{},
			{ 1: { nested: { a: 1, b: 2 } } },
		);
		expect(result).toEqual({ a: 1, b: 2 });
	});

	test("scalar identifierData with array value (array stored as a property, not as the identifierData entry)", () => {
		const result = execute("{{tags:1}}", {}, { 1: { tags: ["x", "y", "z"] } });
		expect(result).toEqual(["x", "y", "z"]);
	});

	test("scalar identifierSchemas still infer scalar types", () => {
		const result = analyze(
			"{{meetingId:1}}",
			{},
			{
				identifierSchemas: {
					1: {
						type: "object",
						properties: { meetingId: { type: "string" } },
						required: ["meetingId"],
					},
				},
			},
		);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "string" });
	});

	test("$root:N on scalar identifier still returns the object", () => {
		const result = execute(
			"{{$root:1}}",
			{},
			{ 1: { meetingId: "abc", count: 42 } },
		);
		expect(result).toEqual({ meetingId: "abc", count: 42 });
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 7 : mergeDataWithIdentifiers — Handlebars rendering path
// ═════════════════════════════════════════════════════════════════════════════
//
// NOTE: In Handlebars rendering mode (mixed templates, blocks), aggregated
// identifier data is stored under `$root:N` in the merged context. However,
// since `($root:N)` is parsed by Handlebars as a helper call (not a data
// path), aggregated data cannot be used directly as a sub-expression argument
// to helpers like `map` or `#each` in mixed/block templates.
//
// The primary consumption mechanism is `{{key:N}}` in single-expression mode.

describe("Aggregated identifiers — Handlebars rendering (mixed/block templates)", () => {
	let tp: Typebars;

	beforeEach(() => {
		tp = new Typebars();
	});

	describe("aggregated values in fast-path (text + simple expressions)", () => {
		test("aggregated identifier is stringified in fast-path concatenation", () => {
			const result = tp.execute(
				"IDs: {{accountId:4}}",
				{},
				{ identifierData: { 4: aggregatedData } },
			);
			// In fast-path, the array is stringified via String()
			expect(typeof result).toBe("string");
			expect(result).toBe("IDs: A,B,C");
		});
	});

	describe("scalar identifiers still work in mixed/block templates", () => {
		test("scalar identifier in block template works normally", () => {
			const result = tp.execute(
				"{{#if seqOutput:2}}yes{{else}}no{{/if}}",
				{},
				{ identifierData: { 2: scalarData } },
			);
			expect(result).toBe("yes");
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 8 : Workflow merge scenario — end-to-end
// ═════════════════════════════════════════════════════════════════════════════

describe("Aggregated identifiers — workflow merge scenario", () => {
	let tp: Typebars;

	beforeEach(() => {
		tp = new Typebars();
	});

	test("end-to-end: Node 5 consumes scalar branch + aggregated multi-branch", () => {
		// Simulates the topology:
		//   0 (split) → 1 → 2 → 5 (merge)
		//            └→ 3 (multi) → 4 → 5
		//
		// Node 5's params template consumes:
		// - seqOutput from Node 2 (scalar, identifier 2)
		// - accountIds from Node 4 (aggregated, identifier 4)

		const identifierData = {
			2: { seqOutput: "sequential-result" },
			4: [
				{ accountId: "ACC-001", processedId: "P1" },
				{ accountId: "ACC-002", processedId: "P2" },
				{ accountId: "ACC-003", processedId: "P3" },
			],
		};

		const identifierSchemas: Record<number, JSONSchema7> = {
			2: {
				type: "object",
				properties: { seqOutput: { type: "string" } },
				required: ["seqOutput"],
			},
			4: {
				type: "array",
				items: {
					type: "object",
					properties: {
						accountId: { type: "string" },
						processedId: { type: "string" },
					},
					required: ["accountId", "processedId"],
				},
			},
		};

		// Template for Node 5's params
		const template = {
			sequentialResult: "{{seqOutput:2}}",
			accountIds: "{{accountId:4}}",
			processedIds: "{{processedId:4}}",
		};

		// Analyze
		const analysis = tp.analyze(
			template,
			{},
			{
				identifierSchemas,
			},
		);
		expect(analysis.valid).toBe(true);
		expect(analysis.outputSchema).toEqual({
			type: "object",
			properties: {
				sequentialResult: { type: "string" },
				accountIds: { type: "array", items: { type: "string" } },
				processedIds: { type: "array", items: { type: "string" } },
			},
			required: ["sequentialResult", "accountIds", "processedIds"],
		});

		// Execute
		const result = tp.execute(template, {}, { identifierData });
		expect(result).toEqual({
			sequentialResult: "sequential-result",
			accountIds: ["ACC-001", "ACC-002", "ACC-003"],
			processedIds: ["P1", "P2", "P3"],
		});
	});

	test("end-to-end: direct extraction from aggregated multi-branch", () => {
		const identifierData = {
			4: [
				{ accountId: "A", amount: 100 },
				{ accountId: "B", amount: 200 },
			],
		};

		const identifierSchemas: Record<number, JSONSchema7> = {
			4: {
				type: "array",
				items: {
					type: "object",
					properties: {
						accountId: { type: "string" },
						amount: { type: "number" },
					},
					required: ["accountId", "amount"],
				},
			},
		};

		// Using direct {{key:N}} extraction from aggregated data
		const { analysis, value } = tp.analyzeAndExecute(
			"{{amount:4}}",
			{},
			{},
			{ identifierSchemas, identifierData },
		);

		expect(analysis.valid).toBe(true);
		expect(analysis.outputSchema).toEqual({
			type: "array",
			items: { type: "number" },
		});
		expect(value).toEqual([100, 200]);
	});
});
