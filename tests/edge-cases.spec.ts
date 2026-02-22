import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import {
	analyze,
	clearCompilationCache,
	clearParseCache,
	execute,
} from "../src/index.ts";
import { userSchema } from "./fixtures.ts";

describe("edge cases", () => {
	beforeEach(() => {
		clearParseCache();
		clearCompilationCache();
	});

	test("template vide → string vide", () => {
		const result = execute("", {});
		expect(result).toBe("");
	});

	test("template vide analysé → valid, outputSchema string", () => {
		const result = analyze("", userSchema);
		expect(result.valid).toBe(true);
		// Un template vide produit une string vide
		expect(result.outputSchema).toEqual({ type: "string" });
	});

	test("commentaire Handlebars seul", () => {
		const result = analyze("{{!-- un commentaire --}}", userSchema);
		expect(result.valid).toBe(true);
	});

	test("commentaire inline", () => {
		const result = analyze("{{! commentaire }}", userSchema);
		expect(result.valid).toBe(true);
	});

	test("schema vide → toute propriété est inconnue", () => {
		const result = analyze("{{anything}}", {});
		expect(result.valid).toBe(false);
	});

	test("this dans un each retourne le contexte courant", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				items: { type: "array", items: { type: "number" } },
			},
		};
		const result = analyze("{{#each items}}{{this}}{{/each}}", schema);
		expect(result.valid).toBe(true);
	});

	test("exécution de this dans un each", () => {
		const result = execute("{{#each items}}{{this}} {{/each}}", {
			items: [1, 2, 3],
		});
		expect(result).toBe("1 2 3 ");
	});

	test("schema avec type tableau (multi-types)", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				value: { type: ["string", "null"] },
			},
		};
		const result = analyze("{{value}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: ["string", "null"] });
	});

	test("accès à une propriété sur un schema sans properties", () => {
		const schema: JSONSchema7 = { type: "object" };
		const result = analyze("{{anything}}", schema);
		expect(result.valid).toBe(false);
	});

	test("#each imbriqué avec contexte correct", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				groups: {
					type: "array",
					items: {
						type: "object",
						properties: {
							members: {
								type: "array",
								items: { type: "string" },
							},
						},
					},
				},
			},
		};
		const result = analyze(
			"{{#each groups}}{{#each members}}{{this}}{{/each}}{{/each}}",
			schema,
		);
		expect(result.valid).toBe(true);
	});

	test("exécution de #each imbriqué", () => {
		const data = {
			groups: [{ members: ["a", "b"] }, { members: ["c"] }],
		};
		const result = execute(
			"{{#each groups}}[{{#each members}}{{this}}{{/each}}]{{/each}}",
			data,
		);
		expect(result).toBe("[ab][c]");
	});

	test("données runtime null ne cassent pas l'exécution (dot notation)", () => {
		const result = execute("{{a.b.c}}", { a: null });
		expect(result).toBeUndefined();
	});
});
