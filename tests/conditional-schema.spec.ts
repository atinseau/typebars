import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer.ts";
import { UnsupportedSchemaError } from "../src/errors.ts";
import { assertNoConditionalSchema } from "../src/schema-resolver.ts";
import { Typebars } from "../src/typebars.ts";
import { userSchema } from "./fixtures.ts";

describe("conditional schema detection (if/then/else)", () => {
	// ─── assertNoConditionalSchema ─────────────────────────────────────────

	describe("assertNoConditionalSchema", () => {
		test("does not throw for a simple schema without conditionals", () => {
			expect(() => assertNoConditionalSchema(userSchema)).not.toThrow();
		});

		test("does not throw for an empty schema", () => {
			expect(() => assertNoConditionalSchema({})).not.toThrow();
		});

		test("does not throw for a schema with allOf/anyOf/oneOf", () => {
			const schema: JSONSchema7 = {
				type: "object",
				allOf: [
					{ type: "object", properties: { a: { type: "string" } } },
					{ type: "object", properties: { b: { type: "number" } } },
				],
			};
			expect(() => assertNoConditionalSchema(schema)).not.toThrow();
		});

		test("does not throw for a schema with $ref and definitions", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					Address: {
						type: "object",
						properties: { city: { type: "string" } },
					},
				},
				properties: {
					home: { $ref: "#/definitions/Address" },
				},
			};
			expect(() => assertNoConditionalSchema(schema)).not.toThrow();
		});

		// ── Root-level if/then/else ──────────────────────────────────────────

		test("throws UnsupportedSchemaError for if at root level", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
				else: { properties: { b: { type: "number" } } },
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("throws for if without then/else", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("throws for then without if", () => {
			const schema = {
				type: "object",
				then: { properties: { a: { type: "string" } } },
			} as JSONSchema7;
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("throws for else without if", () => {
			const schema = {
				type: "object",
				else: { properties: { b: { type: "number" } } },
			} as JSONSchema7;
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		// ── Nested in properties ─────────────────────────────────────────────

		test("throws for if/then/else nested inside a property", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					user: {
						type: "object",
						if: { properties: { role: { const: "admin" } } },
						then: { properties: { adminPanel: { type: "boolean" } } },
					},
				},
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("throws for if/then/else deeply nested in properties", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					level1: {
						type: "object",
						properties: {
							level2: {
								type: "object",
								properties: {
									level3: {
										type: "object",
										if: { properties: { x: { const: 1 } } },
										then: { properties: { y: { type: "string" } } },
									},
								},
							},
						},
					},
				},
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		// ── Nested in combinators ────────────────────────────────────────────

		test("throws for if/then/else inside allOf branch", () => {
			const schema: JSONSchema7 = {
				type: "object",
				allOf: [
					{
						type: "object",
						if: { properties: { kind: { const: "x" } } },
						then: { properties: { x: { type: "string" } } },
					},
				],
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("throws for if/then/else inside anyOf branch", () => {
			const schema: JSONSchema7 = {
				type: "object",
				anyOf: [
					{ type: "object", properties: { a: { type: "string" } } },
					{
						type: "object",
						if: { properties: { kind: { const: "b" } } },
						then: { properties: { b: { type: "number" } } },
					},
				],
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("throws for if/then/else inside oneOf branch", () => {
			const schema: JSONSchema7 = {
				type: "object",
				oneOf: [
					{
						type: "object",
						if: { properties: { type: { const: "a" } } },
						then: { properties: { a: { type: "string" } } },
					},
				],
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		// ── Nested in items ──────────────────────────────────────────────────

		test("throws for if/then/else inside array items", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					items: {
						type: "array",
						items: {
							type: "object",
							if: { properties: { status: { const: "active" } } },
							then: { properties: { score: { type: "number" } } },
						},
					},
				},
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("throws for if/then/else inside tuple items", () => {
			const schema: JSONSchema7 = {
				type: "array",
				items: [
					{ type: "string" },
					{
						type: "object",
						if: { properties: { x: { const: 1 } } },
						then: { properties: { y: { type: "string" } } },
					},
				],
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		// ── Nested in additionalProperties ───────────────────────────────────

		test("throws for if/then/else inside additionalProperties schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				additionalProperties: {
					type: "object",
					if: { properties: { kind: { const: "x" } } },
					then: { properties: { value: { type: "string" } } },
				},
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("does not throw for additionalProperties: true", () => {
			const schema: JSONSchema7 = {
				type: "object",
				additionalProperties: true,
			};
			expect(() => assertNoConditionalSchema(schema)).not.toThrow();
		});

		test("does not throw for additionalProperties: false", () => {
			const schema: JSONSchema7 = {
				type: "object",
				additionalProperties: false,
			};
			expect(() => assertNoConditionalSchema(schema)).not.toThrow();
		});

		// ── Nested in definitions ────────────────────────────────────────────

		test("throws for if/then/else inside definitions", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					ConditionalType: {
						type: "object",
						if: { properties: { mode: { const: "advanced" } } },
						then: { properties: { extra: { type: "string" } } },
					},
				},
				properties: {
					data: { $ref: "#/definitions/ConditionalType" },
				},
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("throws for if/then/else inside $defs", () => {
			const schema: JSONSchema7 = {
				type: "object",
				$defs: {
					ConditionalType: {
						type: "object",
						if: { properties: { mode: { const: "advanced" } } },
						then: { properties: { extra: { type: "string" } } },
					},
				},
				properties: {
					data: { $ref: "#/$defs/ConditionalType" },
				},
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		// ── Nested in not ────────────────────────────────────────────────────

		test("throws for if/then/else inside not", () => {
			const schema: JSONSchema7 = {
				type: "object",
				not: {
					if: { properties: { x: { const: 1 } } },
					then: { properties: { y: { type: "string" } } },
				},
			};
			expect(() => assertNoConditionalSchema(schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		// ── Error message and properties ─────────────────────────────────────

		test("error message mentions if/then/else", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
			};
			try {
				assertNoConditionalSchema(schema);
				expect.unreachable("should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(UnsupportedSchemaError);
				const err = error as UnsupportedSchemaError;
				expect(err.keyword).toBe("if/then/else");
				expect(err.message).toContain("if/then/else");
				expect(err.message).toContain("oneOf/anyOf");
			}
		});

		test("error includes the schema path for nested conditionals", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					user: {
						type: "object",
						if: { properties: { role: { const: "admin" } } },
						then: { properties: { panel: { type: "boolean" } } },
					},
				},
			};
			try {
				assertNoConditionalSchema(schema);
				expect.unreachable("should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(UnsupportedSchemaError);
				const err = error as UnsupportedSchemaError;
				expect(err.schemaPath).toBe("/properties/user");
			}
		});

		test("error includes the schema path for combinators", () => {
			const schema: JSONSchema7 = {
				type: "object",
				allOf: [
					{ type: "object", properties: { a: { type: "string" } } },
					{
						type: "object",
						if: { properties: { x: { const: 1 } } },
						then: { properties: { y: { type: "number" } } },
					},
				],
			};
			try {
				assertNoConditionalSchema(schema);
				expect.unreachable("should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(UnsupportedSchemaError);
				const err = error as UnsupportedSchemaError;
				expect(err.schemaPath).toBe("/allOf/1");
			}
		});

		test("toJSON() includes keyword and schemaPath", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
			};
			try {
				assertNoConditionalSchema(schema);
				expect.unreachable("should have thrown");
			} catch (error) {
				const err = error as UnsupportedSchemaError;
				const json = err.toJSON();
				expect(json.name).toBe("UnsupportedSchemaError");
				expect(json.keyword).toBe("if/then/else");
				expect(json.schemaPath).toBe("/");
				expect(typeof json.message).toBe("string");
			}
		});

		// ── Cycle protection ─────────────────────────────────────────────────

		test("handles circular schema references without infinite loop", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					child: { type: "object" },
				},
			};
			// Create a circular reference
			(schema.properties as Record<string, JSONSchema7>).child = schema;
			// Should not throw and should not hang
			expect(() => assertNoConditionalSchema(schema)).not.toThrow();
		});
	});

	// ─── Integration with analyze() ────────────────────────────────────────

	describe("integration with analyze()", () => {
		test("analyze throws UnsupportedSchemaError for schema with if/then/else", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
				else: { properties: { b: { type: "number" } } },
			};
			expect(() => analyze("{{a}}", schema)).toThrow(UnsupportedSchemaError);
		});

		test("analyze throws for nested if/then/else in properties", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
					config: {
						type: "object",
						if: { properties: { mode: { const: "advanced" } } },
						then: { properties: { extra: { type: "string" } } },
					},
				},
			};
			expect(() => analyze("{{name}}", schema)).toThrow(UnsupportedSchemaError);
		});

		test("analyze works normally for schemas without conditionals", () => {
			const result = analyze("{{name}}", userSchema);
			expect(result.valid).toBe(true);
		});
	});

	// ─── Integration with Typebars engine ──────────────────────────────────

	describe("integration with Typebars", () => {
		let engine: Typebars;

		beforeEach(() => {
			engine = new Typebars();
		});

		test("engine.analyze throws UnsupportedSchemaError", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
			};
			expect(() => engine.analyze("{{a}}", schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("engine.validate throws UnsupportedSchemaError", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
			};
			expect(() => engine.validate("{{a}}", schema)).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("engine.analyzeAndExecute throws UnsupportedSchemaError", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
			};
			expect(() =>
				engine.analyzeAndExecute("{{a}}", schema, { a: "hello" }),
			).toThrow(UnsupportedSchemaError);
		});

		test("engine.execute with schema option throws UnsupportedSchemaError", () => {
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
			};
			expect(() => engine.execute("{{a}}", { a: "hello" }, { schema })).toThrow(
				UnsupportedSchemaError,
			);
		});

		test("engine.execute without schema does NOT throw (no analysis)", () => {
			const result = engine.execute("{{a}}", { a: "hello" });
			expect(result).toBe("hello");
		});

		test("compiled template analyze throws UnsupportedSchemaError", () => {
			const tpl = engine.compile("{{a}}");
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
			};
			expect(() => tpl.analyze(schema)).toThrow(UnsupportedSchemaError);
		});
	});

	// ─── Integration with identifierSchemas ────────────────────────────────

	describe("identifierSchemas validation", () => {
		let engine: Typebars;

		beforeEach(() => {
			engine = new Typebars();
		});

		test("throws for if/then/else in an identifierSchema", () => {
			const inputSchema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const identifierSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					if: { properties: { kind: { const: "a" } } },
					then: { properties: { value: { type: "string" } } },
				},
			};
			expect(() =>
				engine.analyze("{{value:1}}", inputSchema, identifierSchemas),
			).toThrow(UnsupportedSchemaError);
		});

		test("throws for nested if/then/else in identifierSchema properties", () => {
			const inputSchema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const identifierSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: {
						config: {
							type: "object",
							if: { properties: { mode: { const: "x" } } },
							then: { properties: { extra: { type: "string" } } },
						},
					},
				},
			};
			expect(() =>
				engine.analyze("{{config.extra:1}}", inputSchema, identifierSchemas),
			).toThrow(UnsupportedSchemaError);
		});

		test("does not throw when identifierSchemas are clean", () => {
			const inputSchema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const identifierSchemas: Record<number, JSONSchema7> = {
				1: {
					type: "object",
					properties: { meetingId: { type: "string" } },
				},
			};
			const result = engine.analyze(
				"{{meetingId:1}}",
				inputSchema,
				identifierSchemas,
			);
			expect(result.valid).toBe(true);
		});

		test("analyzeAndExecute throws for conditional identifierSchema", () => {
			const inputSchema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			expect(() =>
				engine.analyzeAndExecute(
					"{{value:1}}",
					inputSchema,
					{ name: "test" },
					{
						identifierSchemas: {
							1: {
								type: "object",
								if: { properties: { x: { const: 1 } } },
								then: { properties: { value: { type: "string" } } },
							},
						},
						identifierData: { 1: { value: "hello" } },
					},
				),
			).toThrow(UnsupportedSchemaError);
		});
	});

	// ─── Object templates ──────────────────────────────────────────────────

	describe("object templates", () => {
		test("throws for if/then/else in schema even with object template", () => {
			const engine = new Typebars();
			const schema: JSONSchema7 = {
				type: "object",
				if: { properties: { kind: { const: "a" } } },
				then: { properties: { a: { type: "string" } } },
				else: { properties: { b: { type: "number" } } },
			};
			expect(() => engine.analyze({ result: "{{a}}" }, schema)).toThrow(
				UnsupportedSchemaError,
			);
		});
	});
});
