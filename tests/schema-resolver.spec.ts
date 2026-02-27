import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import {
	resolveArrayItems,
	resolveSchemaPath,
	simplifySchema,
} from "../src/schema-resolver";
import { userSchema } from "./fixtures";

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
	});
});
