import { describe, expect, test } from "bun:test";
import { TemplateAnalysisError, TemplateEngine } from "../src/index.ts";
import { userData, userSchema } from "./fixtures.ts";

describe("TemplateEngine", () => {
	describe("isValidSyntax", () => {
		const engine = new TemplateEngine();

		test("retourne true pour un template simple valide", () => {
			expect(engine.isValidSyntax("Hello {{name}}")).toBe(true);
		});

		test("retourne true pour un bloc valide", () => {
			expect(engine.isValidSyntax("{{#if x}}yes{{/if}}")).toBe(true);
		});

		test("retourne false pour un tag fermant incorrect", () => {
			expect(engine.isValidSyntax("{{#if x}}oops{{/each}}")).toBe(false);
		});

		test("retourne false pour un bloc non fermé", () => {
			expect(engine.isValidSyntax("{{#if x}}")).toBe(false);
		});

		test("retourne true pour du texte pur", () => {
			expect(engine.isValidSyntax("no expressions")).toBe(true);
		});

		test("retourne true pour un template vide", () => {
			expect(engine.isValidSyntax("")).toBe(true);
		});
	});

	describe("mode strict (défaut)", () => {
		const engine = new TemplateEngine();

		test("execute lève TemplateAnalysisError si le schema invalide le template", () => {
			expect(() =>
				engine.execute("{{badProp}}", { badProp: "x" }, userSchema),
			).toThrow(TemplateAnalysisError);
		});

		test("execute fonctionne si le schema valide le template", () => {
			const result = engine.execute("{{name}}", userData, userSchema);
			expect(result).toBe("Alice");
		});

		test("execute fonctionne sans schema (pas de validation)", () => {
			const result = engine.execute("{{anything}}", { anything: 42 });
			expect(result).toBe(42);
		});
	});

	describe("analyze", () => {
		const engine = new TemplateEngine();

		test("retourne un AnalysisResult avec valid, diagnostics, outputSchema", () => {
			const result = engine.analyze("{{name}}", userSchema);
			expect(result).toHaveProperty("valid");
			expect(result).toHaveProperty("diagnostics");
			expect(result).toHaveProperty("outputSchema");
		});

		test("outputSchema reflète le type de l'expression unique", () => {
			expect(engine.analyze("{{age}}", userSchema).outputSchema).toEqual({
				type: "number",
			});
		});

		test("outputSchema est string pour un template mixte", () => {
			expect(engine.analyze("Hello {{name}}", userSchema).outputSchema).toEqual(
				{ type: "string" },
			);
		});
	});

	describe("analyzeAndExecute", () => {
		const engine = new TemplateEngine();

		test("retourne analysis et value quand le template est valide", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{age}}",
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "number" });
			expect(value).toBe(30);
		});

		test("retourne value undefined quand le template est invalide en mode strict", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{badProp}}",
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});
	});
});
