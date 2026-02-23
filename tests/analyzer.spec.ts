import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer.ts";
import { clearParseCache } from "../src/parser.ts";
import { userSchema } from "./fixtures.ts";

describe("analyzer", () => {
	beforeEach(() => {
		clearParseCache();
	});

	describe("inférence du type de sortie (outputSchema)", () => {
		test("expression unique string → { type: 'string' }", () => {
			const result = analyze("{{name}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("expression unique number → { type: 'number' }", () => {
			const result = analyze("{{age}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("expression unique boolean → { type: 'boolean' }", () => {
			const result = analyze("{{active}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("expression unique integer → { type: 'integer' }", () => {
			const result = analyze("{{score}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("expression unique object → schema complet de l'objet", () => {
			const result = analyze("{{address}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					city: { type: "string" },
					zip: { type: "string" },
				},
			});
		});

		test("expression unique array → schema du tableau", () => {
			const result = analyze("{{tags}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("expression unique avec dot notation → type de la feuille", () => {
			const result = analyze("{{address.city}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("expression unique avec enum → préserve l'enum", () => {
			const result = analyze("{{metadata.role}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "string",
				enum: ["admin", "user", "guest"],
			});
		});

		test("template mixte (texte + expression) → { type: 'string' }", () => {
			const result = analyze("Hello {{name}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template avec plusieurs expressions → { type: 'string' }", () => {
			const result = analyze("{{name}} ({{age}})", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template avec bloc #if → { type: 'string' }", () => {
			const result = analyze("{{#if active}}yes{{else}}no{{/if}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template avec bloc #each → { type: 'string' }", () => {
			const result = analyze("{{#each tags}}{{this}} {{/each}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template avec bloc #with → { type: 'string' }", () => {
			const result = analyze("{{#with address}}{{city}}{{/with}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("texte pur sans expression → { type: 'string' }", () => {
			const result = analyze("Just plain text", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	describe("inférence du type de sortie — bloc unique (single block)", () => {
		test("#if avec littéraux numériques dans les deux branches → number", () => {
			const result = analyze(
				"{{#if active}}\n  10\n{{else}}\n  20\n{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("#if avec littéraux numériques inline → number", () => {
			const result = analyze("{{#if active}}10{{else}}20{{/if}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("#if avec littéraux décimaux → number", () => {
			const result = analyze(
				"{{#if active}}3.14{{else}}-2.5{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("#if avec littéraux booléens → boolean", () => {
			const result = analyze(
				"{{#if active}}true{{else}}false{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("#if avec littéral null dans une branche → null | string", () => {
			const result = analyze(
				"{{#if active}}null{{else}}fallback{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "null" }, { type: "string" }],
			});
		});

		test("#if avec types mixtes (number et string) → oneOf", () => {
			const result = analyze(
				"{{#if active}}42{{else}}hello{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});

		test("#if avec expression unique dans chaque branche → type de l'expression", () => {
			const result = analyze(
				"{{#if active}}{{age}}{{else}}{{score}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			// age est number, score est integer → oneOf
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "integer" }],
			});
		});

		test("#if avec même type d'expression dans les deux branches → type unique", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{else}}{{address.city}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("#if avec expression unique et whitespace autour → type de l'expression", () => {
			const result = analyze(
				"{{#if active}}\n  {{age}}\n{{else}}\n  {{score}}\n{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "integer" }],
			});
		});

		test("#with comme bloc unique → type du corps", () => {
			const result = analyze("{{#with address}}{{city}}{{/with}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("#each comme bloc unique → toujours string", () => {
			const result = analyze("{{#each tags}}{{this}}{{/each}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("#unless comme bloc unique avec littéraux numériques → number", () => {
			const result = analyze(
				"{{#unless active}}0{{else}}1{{/unless}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("expression unique avec whitespace autour → type brut préservé", () => {
			const result = analyze("  {{age}}  ", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});
	});

	describe("validation — propriétés existantes", () => {
		test("valide un accès simple", () => {
			const result = analyze("{{name}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("valide un accès imbriqué", () => {
			const result = analyze("{{address.city}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("valide un accès profond", () => {
			const result = analyze("{{metadata.role}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("valide un template avec plusieurs accès valides", () => {
			const result = analyze("{{name}} {{age}} {{active}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	describe("validation — propriétés inexistantes", () => {
		test("détecte une propriété inexistante de premier niveau", () => {
			const result = analyze("{{firstName}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.severity).toBe("error");
			expect(result.diagnostics[0]?.message).toContain("firstName");
		});

		test("détecte une propriété inexistante en profondeur", () => {
			const result = analyze("{{address.country}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("address.country");
		});

		test("détecte une propriété inexistante dans un template mixte", () => {
			const result = analyze("Hello {{unknown}}!", userSchema);
			expect(result.valid).toBe(false);
		});

		test("détecte plusieurs propriétés inexistantes", () => {
			const result = analyze("{{foo}} and {{bar}}", userSchema);
			expect(result.valid).toBe(false);
			expect(
				result.diagnostics.filter((d) => d.severity === "error"),
			).toHaveLength(2);
		});
	});

	describe("validation — blocs #if / #unless", () => {
		test("#if avec une condition valide est valid", () => {
			const result = analyze("{{#if active}}yes{{/if}}", userSchema);
			expect(result.valid).toBe(true);
		});

		test("#if avec else, toutes expressions valides", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{else}}unknown{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("#if avec une condition inexistante → erreur", () => {
			const result = analyze("{{#if nonexistent}}yes{{/if}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("nonexistent");
		});

		test("#if valide les expressions dans les deux branches", () => {
			const result = analyze(
				"{{#if active}}{{badProp1}}{{else}}{{badProp2}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
			// Erreurs pour la condition qui n'existe pas ? Non, active existe.
			// Mais badProp1 et badProp2 n'existent pas.
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors.length).toBe(2);
		});

		test("#unless avec une condition valide", () => {
			const result = analyze(
				"{{#unless active}}no{{else}}yes{{/unless}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});
	});

	describe("validation — bloc #each", () => {
		test("#each sur un tableau valide", () => {
			const result = analyze("{{#each tags}}{{this}}{{/each}}", userSchema);
			expect(result.valid).toBe(true);
		});

		test("#each sur un tableau d'objets — accès aux propriétés des items", () => {
			const result = analyze(
				"{{#each orders}}{{product}}{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("#each sur un tableau d'objets — propriété inexistante dans les items", () => {
			const result = analyze(
				"{{#each orders}}{{badField}}{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("badField");
		});

		test("#each sur un non-tableau → erreur", () => {
			const result = analyze("{{#each name}}{{this}}{{/each}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("array");
		});

		test("#each sur une propriété inexistante → erreur", () => {
			const result = analyze(
				"{{#each nonexistent}}{{this}}{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
		});

		test("#each avec branche else est valide", () => {
			const result = analyze(
				"{{#each tags}}{{this}}{{else}}empty{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});
	});

	describe("validation — bloc #with", () => {
		test("#with sur un objet valide — accès interne correct", () => {
			const result = analyze("{{#with address}}{{city}}{{/with}}", userSchema);
			expect(result.valid).toBe(true);
		});

		test("#with — accès à une propriété inexistante dans le sous-contexte", () => {
			const result = analyze(
				"{{#with address}}{{country}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("country");
		});

		test("#with sur une propriété inexistante → erreur", () => {
			const result = analyze(
				"{{#with nonexistent}}{{foo}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
		});

		test("#with imbriqué dans #with", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					level1: {
						type: "object",
						properties: {
							level2: {
								type: "object",
								properties: {
									value: { type: "string" },
								},
							},
						},
					},
				},
			};
			const result = analyze(
				"{{#with level1}}{{#with level2}}{{value}}{{/with}}{{/with}}",
				schema,
			);
			expect(result.valid).toBe(true);
		});
	});

	describe("validation — combinaisons complexes", () => {
		test("#with contenant un #each", () => {
			const result = analyze(
				"{{#with metadata}}{{#each permissions}}{{this}}{{/each}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("#if contenant un #each", () => {
			const result = analyze(
				"{{#if active}}{{#each tags}}{{this}}{{/each}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("template complexe mélange de texte, expressions et blocs", () => {
			const result = analyze(
				"{{name}} ({{metadata.role}}): {{#each tags}}{{this}} {{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("#each d'objets avec accès à plusieurs propriétés", () => {
			const result = analyze(
				"{{#each orders}}#{{id}} {{product}} x{{quantity}}{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});
	});

	describe("validation — $ref", () => {
		const schemaWithRef: JSONSchema7 = {
			type: "object",
			definitions: {
				Address: {
					type: "object",
					properties: {
						street: { type: "string" },
						city: { type: "string" },
					},
				},
			},
			properties: {
				home: { $ref: "#/definitions/Address" },
				work: { $ref: "#/definitions/Address" },
			},
		};

		test("résout un accès via $ref", () => {
			const result = analyze("{{home.city}}", schemaWithRef);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template mixte avec plusieurs $ref", () => {
			const result = analyze("{{home.city}} — {{work.street}}", schemaWithRef);
			expect(result.valid).toBe(true);
		});

		test("propriété inexistante derrière un $ref → erreur", () => {
			const result = analyze("{{home.zip}}", schemaWithRef);
			expect(result.valid).toBe(false);
		});
	});

	describe("validation — propriétés intrinsèques des tableaux", () => {
		test("accès à .length sur un tableau est valide", () => {
			const result = analyze("{{tags.length}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("accès à .length sur un tableau d'objets est valide", () => {
			const result = analyze("{{orders.length}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("accès à .length dans un template mixte → string", () => {
			const result = analyze("Total: {{orders.length}} commandes", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("accès à .length dans un bloc #if est valide", () => {
			const result = analyze(
				"{{#if tags}}{{tags.length}}{{else}}0{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("accès à .length sur un non-tableau → erreur", () => {
			const result = analyze("{{name.length}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.code).toBe("UNKNOWN_PROPERTY");
		});

		test("accès à .length sur un tableau imbriqué via #with", () => {
			const result = analyze(
				"{{#with metadata}}{{permissions.length}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	describe("diagnostics contiennent une position (loc)", () => {
		test("l'erreur inclut la position dans le source", () => {
			const result = analyze("Hello {{badProp}}", userSchema);
			expect(result.diagnostics).toHaveLength(1);
			const diag = result.diagnostics[0];
			if (!diag) throw new Error("Expected diagnostic");
			expect(diag.loc).toBeDefined();
			expect(diag.loc?.start.line).toBeGreaterThanOrEqual(1);
		});
	});
});
