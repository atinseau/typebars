import { beforeEach, describe, expect, it } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { Typebars } from "../src/typebars";

// ─── Shared schema ──────────────────────────────────────────────────────────

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		name: { type: "string" },
		age: { type: "number" },
		score: { type: "number" },
		active: { type: "boolean" },
		role: { type: "string" },
		count: { type: "number" },
		threshold: { type: "number" },
		account: {
			type: "object",
			properties: {
				id: { type: "string" },
				balance: { type: "number" },
			},
			required: ["id", "balance"],
		},
		tags: {
			type: "array",
			items: { type: "string" },
		},
	},
	required: ["name", "age", "score", "active", "role", "count", "threshold"],
};

const data = {
	name: "Alice",
	age: 30,
	score: 85,
	active: true,
	role: "admin",
	count: 5,
	threshold: 100,
	account: { id: "acc-1", balance: 250 },
	tags: ["developer", "typescript"],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SubExpression resolution", () => {
	let engine: Typebars;

	beforeEach(() => {
		engine = new Typebars();
	});

	// ─── Basic: no warnings for known helpers ────────────────────────────

	describe("no warnings for known sub-expression helpers", () => {
		it("(lt a b) inside #if produces no diagnostics", () => {
			const result = engine.analyze(
				"{{#if (lt count threshold)}}low{{else}}high{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(gt a b) inside #if produces no diagnostics", () => {
			const result = engine.analyze(
				"{{#if (gt score 50)}}pass{{else}}fail{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(eq a b) inside #if produces no diagnostics", () => {
			const result = engine.analyze(
				'{{#if (eq role "admin")}}yes{{else}}no{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(not expr) inside #if produces no diagnostics", () => {
			const result = engine.analyze(
				"{{#if (not active)}}inactive{{else}}active{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(lte a b) inside #unless produces no diagnostics", () => {
			const result = engine.analyze(
				"{{#unless (lte score 50)}}high score{{/unless}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(gte a b) inside #if produces no diagnostics", () => {
			const result = engine.analyze(
				"{{#if (gte age 18)}}adult{{else}}minor{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(ne a b) inside #if produces no diagnostics", () => {
			const result = engine.analyze(
				'{{#if (ne role "guest")}}allowed{{else}}denied{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	// ─── Nested property access inside sub-expressions ───────────────────

	describe("nested property access in sub-expression arguments", () => {
		it("(lt account.balance 500) resolves the nested path", () => {
			const result = engine.analyze(
				"{{#if (lt account.balance 500)}}low{{else}}high{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(gt account.balance 0) resolves the nested path", () => {
			const result = engine.analyze(
				"{{#if (gt account.balance 0)}}positive{{else}}zero{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(eq account.id literal) resolves nested string property", () => {
			const result = engine.analyze(
				'{{#if (eq account.id "acc-1")}}match{{else}}no match{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	// ─── Return type inference ──────────────────────────────────────────

	describe("return type inference through sub-expressions", () => {
		it("#if with sub-expression condition infers branch types correctly", () => {
			const result = engine.analyze(
				"{{#if (lt count 10)}}{{age}}{{else}}{{name}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// age is number, name is string → oneOf
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});

		it("#if with sub-expression and same-type branches → single type", () => {
			const result = engine.analyze(
				"{{#if (gt score 50)}}{{age}}{{else}}{{count}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		it("#if with sub-expression and no else → branch type", () => {
			const result = engine.analyze(
				"{{#if (eq active true)}}{{name}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		it("#if with sub-expression and literal branches → literal type", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}minor{{else}}adult{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	// ─── Nested sub-expressions ──────────────────────────────────────────

	describe("nested sub-expressions", () => {
		it("(and (eq ...) (lt ...)) produces no diagnostics", () => {
			const result = engine.analyze(
				'{{#if (and (eq role "admin") (gt score 50))}}yes{{else}}no{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(or (not ...) (eq ...)) produces no diagnostics", () => {
			const result = engine.analyze(
				'{{#if (or (not active) (eq role "guest"))}}restricted{{else}}ok{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("deeply nested sub-expressions produce no diagnostics", () => {
			const result = engine.analyze(
				'{{#if (and (or (lt age 18) (gt age 65)) (eq role "special"))}}yes{{else}}no{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	// ─── Unknown helper in sub-expression ────────────────────────────────

	describe("unknown helper in sub-expression", () => {
		it("emits UNKNOWN_HELPER warning for unknown sub-expression helper", () => {
			const result = engine.analyze(
				"{{#if (unknownHelper count)}}yes{{else}}no{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true); // warnings don't invalidate
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.code).toBe("UNKNOWN_HELPER");
			expect(result.diagnostics[0]?.severity).toBe("warning");
		});

		it("unknown sub-expression helper message includes helper name", () => {
			const result = engine.analyze(
				"{{#if (myCustomCheck name)}}yes{{/if}}",
				schema,
			);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.message).toContain("myCustomCheck");
		});
	});

	// ─── Argument validation in sub-expressions ──────────────────────────

	describe("argument validation in sub-expressions", () => {
		it("missing property in sub-expression argument → error", () => {
			const result = engine.analyze(
				"{{#if (lt nonExistent 500)}}yes{{else}}no{{/if}}",
				schema,
			);
			expect(result.valid).toBe(false);
			expect(
				result.diagnostics.some((d) => d.code === "UNKNOWN_PROPERTY"),
			).toBe(true);
		});

		it("missing nested property in sub-expression argument → error", () => {
			const result = engine.analyze(
				"{{#if (lt account.nonExistent 500)}}yes{{else}}no{{/if}}",
				schema,
			);
			expect(result.valid).toBe(false);
			expect(
				result.diagnostics.some((d) => d.code === "UNKNOWN_PROPERTY"),
			).toBe(true);
		});

		it("too few arguments for helper → MISSING_ARGUMENT error", () => {
			const result = engine.analyze(
				"{{#if (lt count)}}yes{{else}}no{{/if}}",
				schema,
			);
			expect(result.valid).toBe(false);
			expect(
				result.diagnostics.some((d) => d.code === "MISSING_ARGUMENT"),
			).toBe(true);
		});
	});

	// ─── Type checking in sub-expressions ────────────────────────────────

	describe("type checking in sub-expression arguments", () => {
		it("string argument where number expected → TYPE_MISMATCH error", () => {
			const result = engine.analyze(
				"{{#if (lt name 500)}}yes{{else}}no{{/if}}",
				schema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.some((d) => d.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("boolean argument where number expected → TYPE_MISMATCH error", () => {
			const result = engine.analyze(
				"{{#if (lt active 10)}}yes{{else}}no{{/if}}",
				schema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.some((d) => d.code === "TYPE_MISMATCH")).toBe(
				true,
			);
		});

		it("number arguments for lt → no type mismatch", () => {
			const result = engine.analyze(
				"{{#if (lt age score)}}younger{{else}}older{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics.some((d) => d.code === "TYPE_MISMATCH")).toBe(
				false,
			);
		});

		it("number literal argument for lt → no type mismatch", () => {
			const result = engine.analyze(
				"{{#if (lt age 50)}}young{{else}}old{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	// ─── Execution correctness ───────────────────────────────────────────

	describe("execution with sub-expressions", () => {
		it("(lt count 500) evaluates correctly at runtime", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{#if (lt count 500)}}low{{else}}high{{/if}}",
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.diagnostics).toHaveLength(0);
			expect(value).toBe("low");
		});

		it("(gt score 50) evaluates correctly at runtime", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{#if (gt score 50)}}pass{{else}}fail{{/if}}",
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("pass");
		});

		it("(eq role 'admin') evaluates correctly at runtime", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				'{{#if (eq role "admin")}}admin{{else}}user{{/if}}',
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("admin");
		});

		it("(not active) evaluates correctly at runtime", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{#if (not active)}}inactive{{else}}active{{/if}}",
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("active");
		});

		it("nested (and (eq ...) (lt ...)) evaluates correctly", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				'{{#if (and (eq role "admin") (lt count 10))}}yes{{else}}no{{/if}}',
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("yes");
		});

		it("nested (or (not ...) (gt ...)) evaluates correctly", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{#if (or (not active) (gt score 80))}}yes{{else}}no{{/if}}",
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("yes");
		});

		it("(lt account.balance 500) with nested property evaluates correctly", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{#if (lt account.balance 500)}}low{{else}}high{{/if}}",
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.diagnostics).toHaveLength(0);
			expect(value).toBe("low");
		});
	});

	// ─── Sub-expression inside #unless ────────────────────────────────────

	describe("sub-expression inside #unless", () => {
		it("(lt ...) inside #unless produces no diagnostics", () => {
			const result = engine.analyze(
				"{{#unless (lt age 18)}}adult{{/unless}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(lt ...) inside #unless evaluates correctly", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{#unless (lt age 18)}}adult{{else}}minor{{/unless}}",
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("adult");
		});
	});

	// ─── Mixed template with sub-expressions ─────────────────────────────

	describe("mixed template with sub-expressions", () => {
		it("text + sub-expression block produces no diagnostics", () => {
			const result = engine.analyze(
				'Status: {{#if (eq role "admin")}}Admin{{else}}User{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("multiple blocks with sub-expressions produce no diagnostics", () => {
			const template = `{{#if (gt score 50)}}pass{{else}}fail{{/if}} - {{#if (eq active true)}}on{{else}}off{{/if}}`;
			const result = engine.analyze(template, schema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("sub-expression in #if with body containing expressions", () => {
			const result = engine.analyze(
				"{{#if (lt account.balance 500)}}{{name}} has low balance: {{account.balance}}{{else}}{{name}} is fine{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	// ─── Regression: original bug scenario ───────────────────────────────

	describe("regression: original UNANALYZABLE warning", () => {
		it("exact scenario from the bug report produces no warnings", () => {
			const bugSchema: JSONSchema7 = {
				type: "object",
				properties: {
					showAge: { type: "boolean" },
					showName: { type: "boolean" },
					name: { type: "string" },
					age: { type: "number" },
					account: {
						type: "object",
						properties: {
							id: { type: "string" },
							balance: { type: "number" },
						},
						required: ["id", "balance"],
					},
				},
				required: ["name", "age"],
			};

			const template = `
{{#if showName}}
  {{account.balance}}
{{/if}}

{{#if showAge}}
  {{#if (lt account.balance 500)}}
    {{showAge}}
  {{else}}
    {{name}}
  {{/if}}
{{/if}}
`;

			const result = engine.analyze(template, bugSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// Should not contain any UNANALYZABLE diagnostic
			expect(result.diagnostics.some((d) => d.code === "UNANALYZABLE")).toBe(
				false,
			);
		});

		it("no UNANALYZABLE diagnostic for any known helper sub-expression", () => {
			const helpers = ["lt", "lte", "gt", "gte", "eq", "ne"];
			for (const helper of helpers) {
				const result = engine.analyze(
					`{{#if (${helper} age 50)}}yes{{else}}no{{/if}}`,
					schema,
				);
				expect(result.diagnostics.some((d) => d.code === "UNANALYZABLE")).toBe(
					false,
				);
			}
		});
	});

	// ─── Math helpers as sub-expressions ─────────────────────────────────

	describe("math helpers as sub-expressions", () => {
		it("(add a b) inside (gt ...) produces no diagnostics", () => {
			const result = engine.analyze(
				"{{#if (gt (add age score) 100)}}high{{else}}low{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it("(add a b) evaluates correctly at runtime through sub-expression", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{#if (gt (add age score) 100)}}high{{else}}low{{/if}}",
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			// age=30 + score=85 = 115 > 100 → "high"
			expect(value).toBe("high");
		});
	});

	// ─── compare helper as sub-expression ────────────────────────────────

	describe("compare helper as sub-expression", () => {
		it('(compare a "<" b) produces no diagnostics', () => {
			const result = engine.analyze(
				'{{#if (compare count "<" threshold)}}less{{else}}more{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it('(compare a "<" b) evaluates correctly at runtime', () => {
			const { analysis, value } = engine.analyzeAndExecute(
				'{{#if (compare count "<" threshold)}}less{{else}}more{{/if}}',
				schema,
				data,
			);
			expect(analysis.valid).toBe(true);
			// count=5 < threshold=100 → "less"
			expect(value).toBe("less");
		});
	});

	// ─── contains / in helpers as sub-expressions ────────────────────────

	describe("contains and in helpers as sub-expressions", () => {
		it('(contains name "lic") produces no diagnostics', () => {
			const result = engine.analyze(
				'{{#if (contains name "lic")}}found{{else}}not found{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		it('(in role "admin" "user") produces no diagnostics', () => {
			const result = engine.analyze(
				'{{#if (in role "admin" "user")}}allowed{{else}}denied{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	// ─── Type inference — literal type combinations in branches ──────────

	describe("type inference — literal type combinations with sub-expression conditions", () => {
		it("#if (lt ...) → number literal else boolean literal → oneOf [number, boolean]", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}42{{else}}true{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "boolean" }],
			});
		});

		it("#if (gt ...) → null literal else number literal → oneOf [null, number]", () => {
			const result = engine.analyze(
				"{{#if (gt score 100)}}null{{else}}0{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "null" }, { type: "number" }],
			});
		});

		it("#if (eq ...) → same numeric type both branches → number (not oneOf)", () => {
			const result = engine.analyze(
				'{{#if (eq role "admin")}}3.14{{else}}-5{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		it("#if (ne ...) → boolean literal both branches → boolean", () => {
			const result = engine.analyze(
				'{{#if (ne role "guest")}}true{{else}}false{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		it("#if (and ...) → number literal else string literal → oneOf [number, string]", () => {
			const result = engine.analyze(
				"{{#if (and active (gt score 50))}}100{{else}}fail{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});
	});

	// ─── Type inference — #unless with sub-expression ────────────────────

	describe("type inference — #unless with sub-expression condition", () => {
		it("#unless (gt ...) → expression else expression → oneOf [number, string]", () => {
			const result = engine.analyze(
				"{{#unless (gt age 65)}}{{age}}{{else}}{{name}}{{/unless}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});

		it("#unless (eq ...) → number literal else string literal → oneOf [number, string]", () => {
			const result = engine.analyze(
				'{{#unless (eq role "admin")}}42{{else}}hello{{/unless}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});

		it("#unless (lt ...) with same type both branches → single type", () => {
			const result = engine.analyze(
				"{{#unless (lt count 0)}}{{age}}{{else}}{{score}}{{/unless}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		it("#unless (not ...) with no else → branch type only", () => {
			const result = engine.analyze(
				"{{#unless (not active)}}{{age}}{{/unless}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "number" });
		});
	});

	// ─── Type inference — multiple blocks with sub-expression conditions ─

	describe("type inference — multiple blocks with sub-expression conditions", () => {
		it("two #if blocks with sub-expression conditions and different types → oneOf", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}{{name}}{{/if}}\n{{#if (gt score 50)}}{{age}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});

		it("two #if blocks with sub-expression conditions and same type → single type", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}{{name}}{{/if}}\n{{#if (gt score 50)}}{{role}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		it("#if (sub-expr) + #unless (sub-expr) with different types → oneOf", () => {
			const result = engine.analyze(
				"{{#if (lt count 10)}}{{name}}{{/if}}\n{{#unless (gt age 65)}}{{score}}{{/unless}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});

		it("three blocks with sub-expression conditions → oneOf with all distinct types", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}{{name}}{{/if}}\n{{#if (gt score 50)}}{{age}}{{/if}}\n{{#if (not active)}}{{active}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
			});
		});

		it("#if (sub-expr) with else + another #if (sub-expr) → nested oneOf", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}{{age}}{{else}}{{name}}{{/if}}\n{{#if (gt score 50)}}{{active}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [
					{ oneOf: [{ type: "number" }, { type: "string" }] },
					{ type: "boolean" },
				],
			});
		});
	});

	// ─── Type inference — nested blocks with sub-expression conditions ───

	describe("type inference — nested blocks with sub-expression conditions", () => {
		it("#if (lt ...) → #if (gt ...) → nested type inference", () => {
			const result = engine.analyze(
				"{{#if (lt age 65)}}{{#if (gt score 50)}}{{age}}{{else}}{{name}}{{/if}}{{else}}{{active}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// then: oneOf [number, string], else: boolean
			expect(result.outputSchema).toEqual({
				oneOf: [
					{ oneOf: [{ type: "number" }, { type: "string" }] },
					{ type: "boolean" },
				],
			});
		});

		it("#if (and ...) → #with account → {{balance}} → number", () => {
			const result = engine.analyze(
				'{{#if (and active (eq role "admin"))}}{{#with account}}{{balance}}{{/with}}{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		it("#if (gt ...) → #each tags → always string", () => {
			const result = engine.analyze(
				"{{#if (gt score 50)}}{{#each tags}}{{this}},{{/each}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		it("#if (lt ...) → #each else literal → string (each always string)", () => {
			const result = engine.analyze(
				"{{#if (lt count 100)}}{{#each tags}}{{this}}{{/each}}{{else}}none{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	// ─── Type inference — structured types (object, array) in branches ───

	describe("type inference — structured types in branches with sub-expression conditions", () => {
		it("#if (lt ...) → {{account}} → object schema", () => {
			const result = engine.analyze(
				"{{#if (lt count 10)}}{{account}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					id: { type: "string" },
					balance: { type: "number" },
				},
				required: ["id", "balance"],
			});
		});

		it("#if (gt ...) → {{tags}} → array schema", () => {
			const result = engine.analyze(
				"{{#if (gt score 50)}}{{tags}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		it("#if (eq ...) → {{account}} else {{name}} → oneOf [object, string]", () => {
			const result = engine.analyze(
				'{{#if (eq role "admin")}}{{account}}{{else}}{{name}}{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			const outputSchema = result.outputSchema;
			expect(outputSchema).toHaveProperty("oneOf");
			const oneOf = (outputSchema as { oneOf: unknown[] }).oneOf;
			expect(oneOf).toHaveLength(2);
			// One should be the object schema, the other string
			expect(oneOf).toContainEqual({ type: "string" });
			expect(oneOf).toContainEqual({
				type: "object",
				properties: {
					id: { type: "string" },
					balance: { type: "number" },
				},
				required: ["id", "balance"],
			});
		});
	});

	// ─── Type inference — chained else-if pattern ────────────────────────

	describe("type inference — chained else-if with sub-expressions", () => {
		it("#if (lt age 18) → minor, else #if (lt age 65) → adult, else senior → string", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}minor{{else}}{{#if (lt age 65)}}adult{{else}}senior{{/if}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		it("chained else-if with different types across levels → oneOf", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}{{age}}{{else}}{{#if (gt score 90)}}{{name}}{{else}}{{active}}{{/if}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// then: number, else: oneOf [string, boolean]
			expect(result.outputSchema).toEqual({
				oneOf: [
					{ type: "number" },
					{ oneOf: [{ type: "string" }, { type: "boolean" }] },
				],
			});
		});

		it("three-level chained else-if all string → single string", () => {
			const result = engine.analyze(
				'{{#if (eq role "admin")}}admin{{else}}{{#if (eq role "user")}}user{{else}}guest{{/if}}{{/if}}',
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	// ─── Condition type does not leak into output type ───────────────────

	describe("condition type isolation — sub-expression boolean does not affect output type", () => {
		it("(lt ...) returns boolean but output type is based on branches, not condition", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}{{name}}{{else}}{{age}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// Output should be oneOf [string, number], NOT boolean
			const outputSchema = result.outputSchema;
			expect(outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
			// Explicitly verify boolean is not in the output
			const oneOf = (outputSchema as { oneOf: Array<{ type: string }> }).oneOf;
			expect(oneOf.some((s) => s.type === "boolean")).toBe(false);
		});

		it("(and ...) returns boolean but branches determine output schema", () => {
			const result = engine.analyze(
				"{{#if (and active (gt score 50))}}{{account.balance}}{{else}}{{count}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// Both branches are number → single number, not boolean
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		it("(not ...) returns boolean but single branch determines output", () => {
			const result = engine.analyze(
				"{{#if (not active)}}{{account}}{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// Output should be the object schema, not boolean
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					id: { type: "string" },
					balance: { type: "number" },
				},
				required: ["id", "balance"],
			});
		});
	});

	// ─── Whitespace handling with sub-expression conditions ──────────────

	describe("type inference — whitespace in branches with sub-expression conditions", () => {
		it("whitespace-surrounded expressions preserve types with sub-expression condition", () => {
			const result = engine.analyze(
				"{{#if (lt age 18)}}\n  {{age}}\n{{else}}\n  {{name}}\n{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});

		it("whitespace-surrounded literals preserve types with sub-expression condition", () => {
			const result = engine.analyze(
				"{{#if (gt score 50)}}\n  42\n{{else}}\n  true\n{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "boolean" }],
			});
		});

		it("heavily indented branches with sub-expression condition", () => {
			const result = engine.analyze(
				"{{#if (and active (lt count 100))}}\n    {{name}}\n{{else}}\n    {{age}}\n{{/if}}",
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});
	});
});
