import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import {
	resolveArrayItems,
	resolveSchemaPath,
	simplifySchema,
} from "../src/schema-resolver.ts";
import { userSchema } from "./fixtures.ts";

describe("schema-resolver", () => {
	describe("resolveSchemaPath", () => {
		test("resolves a top-level property", () => {
			const result = resolveSchemaPath(userSchema, ["name"]);
			expect(result).toEqual({ type: "string" });
		});

		test("resolves a nested path", () => {
			const result = resolveSchemaPath(userSchema, ["address", "city"]);
			expect(result).toEqual({ type: "string" });
		});

		test("resolves a property with enum", () => {
			const result = resolveSchemaPath(userSchema, ["metadata", "role"]);
			expect(result).toEqual({
				type: "string",
				enum: ["admin", "user", "guest"],
			});
		});

		test("returns undefined for a non-existent path", () => {
			expect(resolveSchemaPath(userSchema, ["nonexistent"])).toBeUndefined();
		});

		test("returns undefined for a non-existent deeply nested path", () => {
			expect(
				resolveSchemaPath(userSchema, ["address", "country"]),
			).toBeUndefined();
		});

		test("returns the root schema for an empty path", () => {
			const result = resolveSchemaPath(userSchema, []);
			expect(result).toEqual(userSchema);
		});

		test("resolves a $ref to definitions", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					Address: {
						type: "object",
						properties: {
							city: { type: "string" },
						},
					},
				},
				properties: {
					home: { $ref: "#/definitions/Address" },
				},
			};
			const result = resolveSchemaPath(schema, ["home", "city"]);
			expect(result).toEqual({ type: "string" });
		});

		test("resolves a nested $ref (ref to ref)", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					Name: { type: "string" },
					Person: {
						type: "object",
						properties: {
							name: { $ref: "#/definitions/Name" },
						},
					},
				},
				properties: {
					user: { $ref: "#/definitions/Person" },
				},
			};
			const result = resolveSchemaPath(schema, ["user", "name"]);
			expect(result).toEqual({ type: "string" });
		});

		test("handles additionalProperties: true", () => {
			const schema: JSONSchema7 = {
				type: "object",
				additionalProperties: true,
			};
			const result = resolveSchemaPath(schema, ["anything"]);
			expect(result).toEqual({}); // unknown type
		});

		test("handles additionalProperties with a schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				additionalProperties: { type: "number" },
			};
			const result = resolveSchemaPath(schema, ["anything"]);
			expect(result).toEqual({ type: "number" });
		});

		test("returns undefined when additionalProperties: false", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
				additionalProperties: false,
			};
			expect(resolveSchemaPath(schema, ["unknown"])).toBeUndefined();
		});

		test("resolves via allOf", () => {
			const schema: JSONSchema7 = {
				type: "object",
				allOf: [
					{ type: "object", properties: { a: { type: "string" } } },
					{ type: "object", properties: { b: { type: "number" } } },
				],
			};
			expect(resolveSchemaPath(schema, ["a"])).toEqual({ type: "string" });
			expect(resolveSchemaPath(schema, ["b"])).toEqual({ type: "number" });
		});

		test("resolves via oneOf", () => {
			const schema: JSONSchema7 = {
				type: "object",
				oneOf: [
					{ type: "object", properties: { x: { type: "string" } } },
					{ type: "object", properties: { y: { type: "number" } } },
				],
			};
			expect(resolveSchemaPath(schema, ["x"])).toEqual({ type: "string" });
		});
	});

	describe("intrinsic array properties", () => {
		test("resolves .length on an array → { type: 'integer' }", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					items: { type: "array", items: { type: "string" } },
				},
			};
			const result = resolveSchemaPath(schema, ["items", "length"]);
			expect(result).toEqual({ type: "integer" });
		});

		test("resolves .length on an array of objects → { type: 'integer' }", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					orders: {
						type: "array",
						items: {
							type: "object",
							properties: { id: { type: "number" } },
						},
					},
				},
			};
			const result = resolveSchemaPath(schema, ["orders", "length"]);
			expect(result).toEqual({ type: "integer" });
		});

		test("resolves .length on an array without items → { type: 'integer' }", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					data: { type: "array" },
				},
			};
			const result = resolveSchemaPath(schema, ["data", "length"]);
			expect(result).toEqual({ type: "integer" });
		});

		test("does not resolve .length on a non-array", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
			};
			expect(resolveSchemaPath(schema, ["name", "length"])).toBeUndefined();
		});

		test("resolves .length on an array with multi-type (includes 'array')", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					flexible: { type: ["array", "null"], items: { type: "number" } },
				},
			};
			const result = resolveSchemaPath(schema, ["flexible", "length"]);
			expect(result).toEqual({ type: "integer" });
		});

		test("does not resolve an unknown property on an array", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					items: { type: "array", items: { type: "string" } },
				},
			};
			expect(resolveSchemaPath(schema, ["items", "foo"])).toBeUndefined();
		});
	});

	describe("numeric index access on arrays", () => {
		test("resolves [0] on an array with items schema → items type", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					users: { type: "array", items: { type: "string" } },
				},
			};
			const result = resolveSchemaPath(schema, ["users", "0"]);
			expect(result).toEqual({ type: "string" });
		});

		test("resolves [2] on an array of objects → object item schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					orders: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "number" },
								label: { type: "string" },
							},
						},
					},
				},
			};
			const result = resolveSchemaPath(schema, ["orders", "2"]);
			expect(result).toEqual({
				type: "object",
				properties: {
					id: { type: "number" },
					label: { type: "string" },
				},
			});
		});

		test("resolves nested property after numeric index (e.g. orders.[0].label)", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					orders: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "number" },
								label: { type: "string" },
							},
						},
					},
				},
			};
			const result = resolveSchemaPath(schema, ["orders", "0", "label"]);
			expect(result).toEqual({ type: "string" });
		});

		test("resolves [0] on an array without items → empty schema (unknown)", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					data: { type: "array" },
				},
			};
			const result = resolveSchemaPath(schema, ["data", "0"]);
			expect(result).toEqual({});
		});

		test("resolves [0] on a tuple schema → first item type", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					pair: {
						type: "array",
						items: [{ type: "string" }, { type: "number" }],
					},
				},
			};
			expect(resolveSchemaPath(schema, ["pair", "0"])).toEqual({
				type: "string",
			});
			expect(resolveSchemaPath(schema, ["pair", "1"])).toEqual({
				type: "number",
			});
		});

		test("resolves out-of-bounds index on a tuple → empty schema (unknown)", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					pair: {
						type: "array",
						items: [{ type: "string" }, { type: "number" }],
					},
				},
			};
			const result = resolveSchemaPath(schema, ["pair", "5"]);
			expect(result).toEqual({});
		});

		test("resolves [0] on a multi-type array (includes 'array')", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					flexible: {
						type: ["array", "null"],
						items: { type: "number" },
					},
				},
			};
			const result = resolveSchemaPath(schema, ["flexible", "0"]);
			expect(result).toEqual({ type: "number" });
		});

		test("does not resolve numeric index on a non-array (object)", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: { name: { type: "string" } },
					},
				},
			};
			expect(resolveSchemaPath(schema, ["user", "0"])).toBeUndefined();
		});

		test("resolves [0] on an array with boolean items → empty schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					data: { type: "array", items: true as unknown as JSONSchema7 },
				},
			};
			const result = resolveSchemaPath(schema, ["data", "0"]);
			expect(result).toEqual({});
		});

		test("resolves [0] on an array with $ref items", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					Tag: { type: "string" },
				},
				properties: {
					tags: {
						type: "array",
						items: { $ref: "#/definitions/Tag" },
					},
				},
			};
			const result = resolveSchemaPath(schema, ["tags", "0"]);
			expect(result).toEqual({ type: "string" });
		});

		// ── additionalItems (Draft 7) ────────────────────────────────────

		test("tuple with additionalItems: schema → out-of-bounds index resolves to additionalItems type", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					tuple: {
						type: "array",
						items: [{ type: "string" }],
						additionalItems: { type: "number" },
					},
				},
			};
			// In-range → tuple item type
			expect(resolveSchemaPath(schema, ["tuple", "0"])).toEqual({
				type: "string",
			});
			// Out-of-range → additionalItems type
			expect(resolveSchemaPath(schema, ["tuple", "1"])).toEqual({
				type: "number",
			});
			expect(resolveSchemaPath(schema, ["tuple", "99"])).toEqual({
				type: "number",
			});
		});

		test("tuple with additionalItems: false → out-of-bounds index returns undefined", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					tuple: {
						type: "array",
						items: [{ type: "string" }],
						additionalItems: false,
					},
				},
			};
			// In-range → still resolves
			expect(resolveSchemaPath(schema, ["tuple", "0"])).toEqual({
				type: "string",
			});
			// Out-of-range → forbidden
			expect(resolveSchemaPath(schema, ["tuple", "1"])).toBeUndefined();
			expect(resolveSchemaPath(schema, ["tuple", "5"])).toBeUndefined();
		});

		test("tuple with additionalItems: true → out-of-bounds index returns empty schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					tuple: {
						type: "array",
						items: [{ type: "string" }],
						additionalItems: true,
					},
				},
			};
			expect(resolveSchemaPath(schema, ["tuple", "0"])).toEqual({
				type: "string",
			});
			expect(resolveSchemaPath(schema, ["tuple", "5"])).toEqual({});
		});

		test("tuple without additionalItems → out-of-bounds index returns empty schema (permissive default)", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					tuple: {
						type: "array",
						items: [{ type: "string" }, { type: "number" }],
					},
				},
			};
			expect(resolveSchemaPath(schema, ["tuple", "10"])).toEqual({});
		});

		test("tuple with additionalItems: $ref schema → out-of-bounds resolves through $ref", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					Extra: { type: "boolean" },
				},
				properties: {
					tuple: {
						type: "array",
						items: [{ type: "string" }],
						additionalItems: { $ref: "#/definitions/Extra" },
					},
				},
			};
			expect(resolveSchemaPath(schema, ["tuple", "0"])).toEqual({
				type: "string",
			});
			expect(resolveSchemaPath(schema, ["tuple", "1"])).toEqual({
				type: "boolean",
			});
		});

		// ── $ref in tuple items ──────────────────────────────────────────

		test("tuple items with $ref → resolves correct type per index", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					Name: { type: "string" },
					Age: { type: "integer" },
				},
				properties: {
					record: {
						type: "array",
						items: [
							{ $ref: "#/definitions/Name" },
							{ $ref: "#/definitions/Age" },
						],
					},
				},
			};
			expect(resolveSchemaPath(schema, ["record", "0"])).toEqual({
				type: "string",
			});
			expect(resolveSchemaPath(schema, ["record", "1"])).toEqual({
				type: "integer",
			});
		});

		// ── Combinators with array index ─────────────────────────────────

		test("array inside oneOf → [0] resolves to oneOf of item types", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					data: {
						oneOf: [
							{ type: "array", items: { type: "string" } },
							{ type: "array", items: { type: "number" } },
						],
					},
				},
			};
			const result = resolveSchemaPath(schema, ["data", "0"]);
			expect(result).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});

		test("array inside anyOf → [0] resolves to anyOf of item types", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					data: {
						anyOf: [
							{ type: "array", items: { type: "string" } },
							{ type: "array", items: { type: "boolean" } },
						],
					},
				},
			};
			const result = resolveSchemaPath(schema, ["data", "0"]);
			expect(result).toEqual({
				anyOf: [{ type: "string" }, { type: "boolean" }],
			});
		});

		test("array inside allOf → [0] resolves through allOf", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					data: {
						allOf: [{ type: "array", items: { type: "string" } }],
					},
				},
			};
			const result = resolveSchemaPath(schema, ["data", "0"]);
			expect(result).toEqual({ type: "string" });
		});

		// ── Nested arrays (matrix) ───────────────────────────────────────

		test("nested arrays: matrix.[0] → inner array schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					matrix: {
						type: "array",
						items: {
							type: "array",
							items: { type: "number" },
						},
					},
				},
			};
			const result = resolveSchemaPath(schema, ["matrix", "0"]);
			expect(result).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		test("nested arrays: matrix.[0].[0] → leaf type", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					matrix: {
						type: "array",
						items: {
							type: "array",
							items: { type: "number" },
						},
					},
				},
			};
			const result = resolveSchemaPath(schema, ["matrix", "0", "0"]);
			expect(result).toEqual({ type: "number" });
		});

		// ── Deeply nested: array → object → array → property ────────────

		test("deeply nested path: arr.[0].nested.[0].id", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					arr: {
						type: "array",
						items: {
							type: "object",
							properties: {
								nested: {
									type: "array",
									items: {
										type: "object",
										properties: {
											id: { type: "number" },
										},
									},
								},
							},
						},
					},
				},
			};
			expect(
				resolveSchemaPath(schema, ["arr", "0", "nested", "0", "id"]),
			).toEqual({
				type: "number",
			});
		});

		// ── Array items with oneOf (polymorphic items) ───────────────────

		test("[0] on array with oneOf items → returns the oneOf items schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					events: {
						type: "array",
						items: {
							oneOf: [
								{
									type: "object",
									properties: { kind: { type: "string", const: "click" } },
								},
								{
									type: "object",
									properties: { kind: { type: "string", const: "scroll" } },
								},
							],
						},
					},
				},
			};
			const result = resolveSchemaPath(schema, ["events", "0"]);
			expect(result).toEqual({
				oneOf: [
					{
						type: "object",
						properties: { kind: { type: "string", const: "click" } },
					},
					{
						type: "object",
						properties: { kind: { type: "string", const: "scroll" } },
					},
				],
			});
		});

		test("[0].kind on array with oneOf items → resolves through item combinator", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					events: {
						type: "array",
						items: {
							oneOf: [
								{
									type: "object",
									properties: { kind: { type: "string" } },
								},
								{
									type: "object",
									properties: { kind: { type: "string" } },
								},
							],
						},
					},
				},
			};
			const result = resolveSchemaPath(schema, ["events", "0", "kind"]);
			// resolveSchemaPath does NOT deduplicate — that's simplifySchema's job.
			// Both oneOf branches resolve "kind" → { type: "string" }, so we get
			// a oneOf with two identical entries.
			expect(result).toEqual({
				oneOf: [{ type: "string" }, { type: "string" }],
			});
			// After simplification, it collapses to a single type:
			if (result === undefined)
				throw new Error("Expected result to be defined");
			expect(simplifySchema(result)).toEqual({ type: "string" });
		});
	});

	describe("resolveArrayItems", () => {
		test("resolves items of a simple array", () => {
			const schema: JSONSchema7 = { type: "array", items: { type: "string" } };
			const result = resolveArrayItems(schema, schema);
			expect(result).toEqual({ type: "string" });
		});

		test("resolves items of an array of objects", () => {
			const schema: JSONSchema7 = {
				type: "array",
				items: {
					type: "object",
					properties: { id: { type: "number" } },
				},
			};
			const result = resolveArrayItems(schema, schema);
			expect(result).toEqual({
				type: "object",
				properties: { id: { type: "number" } },
			});
		});

		test("returns an empty schema for an array without items", () => {
			const schema: JSONSchema7 = { type: "array" };
			expect(resolveArrayItems(schema, schema)).toEqual({});
		});

		test("returns undefined for a non-array", () => {
			const schema: JSONSchema7 = { type: "string" };
			expect(resolveArrayItems(schema, schema)).toBeUndefined();
		});

		test("handles a tuple (array items)", () => {
			const schema: JSONSchema7 = {
				type: "array",
				items: [{ type: "string" }, { type: "number" }],
			};
			const result = resolveArrayItems(schema, schema);
			expect(result).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});
	});

	describe("simplifySchema", () => {
		test("unwraps a oneOf with a single element", () => {
			expect(simplifySchema({ oneOf: [{ type: "string" }] })).toEqual({
				type: "string",
			});
		});

		test("unwraps an anyOf with a single element", () => {
			expect(simplifySchema({ anyOf: [{ type: "number" }] })).toEqual({
				type: "number",
			});
		});

		test("unwraps an allOf with a single element", () => {
			expect(simplifySchema({ allOf: [{ type: "boolean" }] })).toEqual({
				type: "boolean",
			});
		});

		test("deduplicates identical entries in oneOf", () => {
			const result = simplifySchema({
				oneOf: [{ type: "string" }, { type: "string" }, { type: "number" }],
			});
			expect(result).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});

		test("simplifies a deduplicated oneOf to a single remaining element", () => {
			const result = simplifySchema({
				oneOf: [{ type: "string" }, { type: "string" }],
			});
			expect(result).toEqual({ type: "string" });
		});

		test("returns the schema unchanged if already simple", () => {
			const schema: JSONSchema7 = { type: "string" };
			expect(simplifySchema(schema)).toEqual(schema);
		});

		// ── Nested recursion tests ───────────────────────────────────────

		test("should simplify single-branch oneOf inside properties", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					value: { oneOf: [{ type: "string" }] },
				},
			};
			expect(simplifySchema(schema)).toEqual({
				type: "object",
				properties: {
					value: { type: "string" },
				},
			});
		});

		test("should deduplicate oneOf inside properties", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					value: {
						oneOf: [{ type: "string" }, { type: "string" }],
					},
				},
			};
			expect(simplifySchema(schema)).toEqual({
				type: "object",
				properties: {
					value: { type: "string" },
				},
			});
		});

		test("should simplify schemas inside allOf branches (multi-branch)", () => {
			const schema: JSONSchema7 = {
				allOf: [
					{
						type: "object",
						properties: {
							x: { anyOf: [{ type: "string" }] },
						},
					},
					{
						type: "object",
						properties: {
							y: { type: "number" },
						},
					},
				],
			};
			const result = simplifySchema(schema);
			expect((result.allOf?.[0] as JSONSchema7).properties?.x).toEqual({
				type: "string",
			});
		});

		test("should simplify schemas inside array items (single schema)", () => {
			const schema: JSONSchema7 = {
				type: "array",
				items: {
					anyOf: [{ type: "number" }, { type: "number" }],
				},
			};
			expect(simplifySchema(schema)).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		test("should simplify schemas inside tuple items", () => {
			const schema: JSONSchema7 = {
				type: "array",
				items: [{ oneOf: [{ type: "string" }] }, { type: "number" }],
			};
			expect(simplifySchema(schema)).toEqual({
				type: "array",
				items: [{ type: "string" }, { type: "number" }],
			});
		});

		test("should simplify schemas inside additionalProperties", () => {
			const schema: JSONSchema7 = {
				type: "object",
				additionalProperties: {
					oneOf: [{ type: "string" }],
				},
			};
			expect(simplifySchema(schema)).toEqual({
				type: "object",
				additionalProperties: { type: "string" },
			});
		});

		test("should handle deeply nested simplification", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: {
							tags: {
								type: "array",
								items: {
									oneOf: [{ type: "string" }],
								},
							},
						},
					},
				},
			};
			const result = simplifySchema(schema);
			expect(
				(
					(result.properties?.user as JSONSchema7).properties
						?.tags as JSONSchema7
				).items,
			).toEqual({
				type: "string",
			});
		});

		test("should be idempotent", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					x: {
						oneOf: [{ type: "string" }, { type: "string" }],
					},
					y: { allOf: [{ type: "number" }] },
				},
			};
			const once = simplifySchema(schema);
			const twice = simplifySchema(once);
			expect(twice).toEqual(once);
		});

		test("should not change properties when nothing is simplifiable", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
				},
			};
			expect(simplifySchema(schema)).toEqual(schema);
		});

		test("should deduplicate anyOf inside items", () => {
			const schema: JSONSchema7 = {
				type: "array",
				items: {
					anyOf: [{ type: "string" }, { type: "number" }, { type: "string" }],
				},
			};
			expect(simplifySchema(schema)).toEqual({
				type: "array",
				items: {
					anyOf: [{ type: "string" }, { type: "number" }],
				},
			});
		});
	});
});
