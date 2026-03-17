import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { Typebars } from "../src/typebars.ts";
import { userSchema } from "./fixtures.ts";

// ─── default helper tests ────────────────────────────────────────────────────

const engine = new Typebars();

// ─── Schema with required + optional properties ─────────────────────────────

const testSchema: JSONSchema7 = {
	type: "object",
	properties: {
		userId: { type: "string" },
		accountId: { type: "string" },
		departmentId: { type: "string" },
		fallbackId: { type: "string" },
		count: { type: "number" },
		label: { type: "string" },
	},
	required: ["fallbackId", "count"],
};

const testData = {
	userId: "user-123",
	accountId: "account-456",
	departmentId: undefined,
	fallbackId: "fallback-789",
	count: 42,
	label: undefined,
};

// ─── Analysis ────────────────────────────────────────────────────────────────

describe("default helper — analysis", () => {
	test("valid: optional property with literal fallback", () => {
		const result = engine.analyze('{{default userId "anonymous"}}', testSchema);
		expect(result.valid).toBe(true);
		expect(
			result.diagnostics.filter((d) => d.severity === "error"),
		).toHaveLength(0);
	});

	test("valid: optional property with required property fallback", () => {
		const result = engine.analyze("{{default userId fallbackId}}", testSchema);
		expect(result.valid).toBe(true);
		expect(
			result.diagnostics.filter((d) => d.severity === "error"),
		).toHaveLength(0);
	});

	test("valid: chain of optional properties ending with required", () => {
		const result = engine.analyze(
			"{{default userId accountId fallbackId}}",
			testSchema,
		);
		expect(result.valid).toBe(true);
		expect(
			result.diagnostics.filter((d) => d.severity === "error"),
		).toHaveLength(0);
	});

	test("valid: chain of optional properties ending with literal", () => {
		const result = engine.analyze(
			'{{default userId accountId "fallback"}}',
			testSchema,
		);
		expect(result.valid).toBe(true);
		expect(
			result.diagnostics.filter((d) => d.severity === "error"),
		).toHaveLength(0);
	});

	test("error: all optional properties with no guaranteed fallback", () => {
		const result = engine.analyze("{{default userId accountId}}", testSchema);
		expect(result.valid).toBe(false);
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0]?.code).toBe("DEFAULT_NO_GUARANTEED_VALUE");
	});

	test("error: single optional property with another optional", () => {
		const result = engine.analyze(
			"{{default departmentId userId}}",
			testSchema,
		);
		expect(result.valid).toBe(false);
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		expect(errors.some((e) => e.code === "DEFAULT_NO_GUARANTEED_VALUE")).toBe(
			true,
		);
	});

	test("error: not enough arguments (0 args)", () => {
		const result = engine.analyze("{{default}}", testSchema);
		// Without args, Handlebars parses "default" as a simple expression, not a helper.
		// It tries to resolve "default" as a property in the schema.
		expect(result.valid).toBe(false);
	});

	test("error: not enough arguments (1 arg)", () => {
		const result = engine.analyze("{{default userId}}", testSchema);
		expect(result.valid).toBe(false);
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		expect(errors.some((e) => e.code === "MISSING_ARGUMENT")).toBe(true);
	});

	test("error: type mismatch between arguments", () => {
		const result = engine.analyze("{{default count fallbackId}}", testSchema);
		expect(result.valid).toBe(false);
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		expect(errors.some((e) => e.code === "TYPE_MISMATCH")).toBe(true);
	});

	// ── Output schema inference ──────────────────────────────────────────

	test("output schema: literal fallback → string", () => {
		const result = engine.analyze('{{default userId "anon"}}', testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "string" });
	});

	test("output schema: required number fallback → number", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				optionalCount: { type: "number" },
				requiredCount: { type: "number" },
			},
			required: ["requiredCount"],
		};
		const result = engine.analyze(
			"{{default optionalCount requiredCount}}",
			schema,
		);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "number" });
	});

	// ── With shared fixtures ─────────────────────────────────────────────

	test("valid: using userSchema — optional active with required name", () => {
		// active is optional, name is required — both are different types, so type error
		const result = engine.analyze("{{default active name}}", userSchema);
		// This should fail due to type mismatch (boolean vs string)
		expect(result.valid).toBe(false);
	});

	test("valid: using userSchema — optional score with literal number", () => {
		const result = engine.analyze("{{default score 0}}", userSchema);
		expect(result.valid).toBe(true);
	});
});

// ─── Sub-expression analysis ─────────────────────────────────────────────────

describe("default helper — sub-expression analysis", () => {
	test("valid: default as sub-expression in if block", () => {
		const result = engine.analyze(
			'{{#if (default userId "anon")}}has value{{/if}}',
			testSchema,
		);
		expect(result.valid).toBe(true);
	});

	test("error: sub-expression with no guaranteed fallback", () => {
		const result = engine.analyze(
			"{{#if (default userId accountId)}}has value{{/if}}",
			testSchema,
		);
		expect(result.valid).toBe(false);
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		expect(errors.some((e) => e.code === "DEFAULT_NO_GUARANTEED_VALUE")).toBe(
			true,
		);
	});

	test("valid: sub-expression with helper as guaranteed fallback", () => {
		const result = engine.analyze(
			"{{#if (default userId (default accountId fallbackId))}}has value{{/if}}",
			testSchema,
		);
		expect(result.valid).toBe(true);
	});
});

// ─── Execution ───────────────────────────────────────────────────────────────

describe("default helper — execution", () => {
	test("returns first non-nullish value", () => {
		const result = engine.execute('{{default userId "anonymous"}}', testData);
		expect(result).toBe("user-123");
	});

	test("falls back to literal when first is nullish", () => {
		const result = engine.execute('{{default departmentId "default-dept"}}', {
			departmentId: null,
		});
		expect(result).toBe("default-dept");
	});

	test("falls back to second variable when first is nullish", () => {
		const result = engine.execute(
			"{{default departmentId fallbackId}}",
			testData,
		);
		expect(result).toBe("fallback-789");
	});

	test("chain: skips nullish values in sequence", () => {
		const data = {
			a: undefined,
			b: null,
			c: "found-it",
		};
		const result = engine.execute('{{default a b c "never"}}', data);
		expect(result).toBe("found-it");
	});

	test("falls back to literal at end of chain", () => {
		const data = {
			a: undefined,
			b: null,
			c: undefined,
		};
		const result = engine.execute('{{default a b c "last-resort"}}', data);
		expect(result).toBe("last-resort");
	});

	test("preserves number type in single-expression mode", () => {
		const result = engine.execute("{{default count 0}}", testData);
		expect(result).toBe(42);
		expect(typeof result).toBe("number");
	});

	test("preserves number fallback type", () => {
		const result = engine.execute("{{default label 0}}", {
			label: undefined,
		});
		expect(result).toBe(0);
		expect(typeof result).toBe("number");
	});

	test("returns null when all values are nullish (edge case)", () => {
		const result = engine.execute("{{default a b}}", {
			a: null,
			b: null,
		});
		expect(result).toBe(null);
	});

	test("works with boolean values", () => {
		const result = engine.execute("{{default active true}}", {
			active: false,
		});
		// false is non-nullish, so it should be returned
		expect(result).toBe(false);
	});

	test("empty string is non-nullish", () => {
		const result = engine.execute('{{default label "fallback"}}', {
			label: "",
		});
		// empty string is non-nullish
		expect(result).toBe("");
	});
});

// ─── Execution + Analysis (analyzeAndExecute) ────────────────────────────────

describe("default helper — analyzeAndExecute", () => {
	test("valid analysis + correct execution", () => {
		const result = engine.analyzeAndExecute(
			'{{default userId "anonymous"}}',
			testSchema,
			testData,
		);
		expect(result.analysis.valid).toBe(true);
		expect(result.value).toBe("user-123");
	});

	test("valid analysis + fallback execution", () => {
		const result = engine.analyzeAndExecute(
			'{{default departmentId "default-dept"}}',
			testSchema,
			{ departmentId: null, fallbackId: "fb" },
		);
		expect(result.analysis.valid).toBe(true);
		expect(result.value).toBe("default-dept");
	});

	test("chain with required property fallback", () => {
		const result = engine.analyzeAndExecute(
			"{{default userId accountId fallbackId}}",
			testSchema,
			{ fallbackId: "fb-123" },
		);
		expect(result.analysis.valid).toBe(true);
		expect(result.value).toBe("fb-123");
	});
});

// ─── Object templates ────────────────────────────────────────────────────────

describe("default helper — object templates", () => {
	test("default in object property value", () => {
		const result = engine.execute(
			{
				id: '{{default userId "anonymous"}}',
				name: "{{name}}",
			},
			{ ...testData, name: "Alice" },
		);
		expect(result).toEqual({
			id: "user-123",
			name: "Alice",
		});
	});

	test("default with nullish value in object template", () => {
		const result = engine.execute(
			{
				dept: '{{default departmentId "unknown"}}',
			},
			{ departmentId: null },
		);
		expect(result).toEqual({
			dept: "unknown",
		});
	});
});

// ─── Mixed templates ─────────────────────────────────────────────────────────

describe("default helper — mixed templates", () => {
	test("default in mixed content", () => {
		const result = engine.execute(
			'Hello {{default userId "stranger"}}!',
			testData,
		);
		expect(result).toBe("Hello user-123!");
	});

	test("default fallback in mixed content", () => {
		const result = engine.execute(
			'Hello {{default departmentId "stranger"}}!',
			{ departmentId: null },
		);
		expect(result).toBe("Hello stranger!");
	});
});
