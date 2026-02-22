import { describe, expect, test } from "bun:test";
import {
	resolveArrayItems,
	resolveSchemaPath,
	simplifySchema,
} from "../src/index.ts";
import type { JSONSchema7 } from "../src/types.ts";
import { userSchema } from "./fixtures.ts";

describe("schema-resolver", () => {
	describe("resolveSchemaPath", () => {
		test("résout une propriété de premier niveau", () => {
			const result = resolveSchemaPath(userSchema, ["name"]);
			expect(result).toEqual({ type: "string" });
		});

		test("résout un chemin imbriqué", () => {
			const result = resolveSchemaPath(userSchema, ["address", "city"]);
			expect(result).toEqual({ type: "string" });
		});

		test("résout une propriété avec enum", () => {
			const result = resolveSchemaPath(userSchema, ["metadata", "role"]);
			expect(result).toEqual({
				type: "string",
				enum: ["admin", "user", "guest"],
			});
		});

		test("retourne undefined pour un chemin inexistant", () => {
			expect(resolveSchemaPath(userSchema, ["nonexistent"])).toBeUndefined();
		});

		test("retourne undefined pour un chemin profond inexistant", () => {
			expect(
				resolveSchemaPath(userSchema, ["address", "country"]),
			).toBeUndefined();
		});

		test("retourne le schema racine pour un chemin vide", () => {
			const result = resolveSchemaPath(userSchema, []);
			expect(result).toEqual(userSchema);
		});

		test("résout un $ref vers definitions", () => {
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

		test("résout un $ref imbriqué (ref vers ref)", () => {
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

		test("gère additionalProperties: true", () => {
			const schema: JSONSchema7 = {
				type: "object",
				additionalProperties: true,
			};
			const result = resolveSchemaPath(schema, ["anything"]);
			expect(result).toEqual({}); // type inconnu
		});

		test("gère additionalProperties avec un schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				additionalProperties: { type: "number" },
			};
			const result = resolveSchemaPath(schema, ["anything"]);
			expect(result).toEqual({ type: "number" });
		});

		test("retourne undefined quand additionalProperties: false", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
				additionalProperties: false,
			};
			expect(resolveSchemaPath(schema, ["unknown"])).toBeUndefined();
		});

		test("résout via allOf", () => {
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

		test("résout via oneOf", () => {
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

	describe("resolveArrayItems", () => {
		test("résout les items d'un tableau simple", () => {
			const schema: JSONSchema7 = { type: "array", items: { type: "string" } };
			const result = resolveArrayItems(schema, schema);
			expect(result).toEqual({ type: "string" });
		});

		test("résout les items d'un tableau d'objets", () => {
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

		test("retourne un schema vide pour un array sans items", () => {
			const schema: JSONSchema7 = { type: "array" };
			expect(resolveArrayItems(schema, schema)).toEqual({});
		});

		test("retourne undefined pour un non-tableau", () => {
			const schema: JSONSchema7 = { type: "string" };
			expect(resolveArrayItems(schema, schema)).toBeUndefined();
		});

		test("gère un tuple (items tableau)", () => {
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
		test("déplie un oneOf à un seul élément", () => {
			expect(simplifySchema({ oneOf: [{ type: "string" }] })).toEqual({
				type: "string",
			});
		});

		test("déplie un anyOf à un seul élément", () => {
			expect(simplifySchema({ anyOf: [{ type: "number" }] })).toEqual({
				type: "number",
			});
		});

		test("déplie un allOf à un seul élément", () => {
			expect(simplifySchema({ allOf: [{ type: "boolean" }] })).toEqual({
				type: "boolean",
			});
		});

		test("déduplique les entrées identiques dans oneOf", () => {
			const result = simplifySchema({
				oneOf: [{ type: "string" }, { type: "string" }, { type: "number" }],
			});
			expect(result).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});

		test("simplifie un oneOf dédupliqué à un seul élément restant", () => {
			const result = simplifySchema({
				oneOf: [{ type: "string" }, { type: "string" }],
			});
			expect(result).toEqual({ type: "string" });
		});

		test("retourne le schema inchangé s'il est déjà simple", () => {
			const schema: JSONSchema7 = { type: "string" };
			expect(simplifySchema(schema)).toEqual(schema);
		});
	});
});
