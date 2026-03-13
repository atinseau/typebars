import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer.ts";
import { Typebars } from "../src/typebars.ts";
import { userSchema } from "./fixtures.ts";

// ─── excludeTemplateExpression Tests ─────────────────────────────────────────
// Verifies that when `excludeTemplateExpression: true` is passed to `analyze()`,
// properties whose values contain Handlebars expressions (`{{…}}`) are excluded
// from the output schema. Only static values (literals, plain strings) are kept.

const opts = { excludeTemplateExpression: true } as const;

describe("excludeTemplateExpression", () => {
	// ─── Standalone analyze() ────────────────────────────────────────────────

	describe("standalone analyze()", () => {
		test("plain string without expressions → kept as-is", () => {
			const result = analyze("Salut", userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("string with expression at root level → analyzed normally (no parent to exclude from)", () => {
			const result = analyze("{{name}}", userSchema, opts);
			expect(result.valid).toBe(true);
			// Root-level strings are analyzed normally even with the flag
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("object with only static values → all properties kept", () => {
			const result = analyze({ name: "Arthur", age: 30 }, userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "integer" },
				},
				required: ["name", "age"],
			});
		});

		test("object with mixed static and template values → template values excluded", () => {
			const result = analyze({ name: "{{name}}", age: 30 }, userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					age: { type: "integer" },
				},
				required: ["age"],
			});
		});

		test("object where all values are templates → empty object schema", () => {
			const result = analyze(
				{ name: "{{name}}", city: "{{address.city}}" },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {},
				required: [],
			});
		});

		test("object with boolean literal value → kept", () => {
			const result = analyze(
				{ active: true, name: "{{name}}" },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					active: { type: "boolean" },
				},
				required: ["active"],
			});
		});

		test("object with null literal value → kept", () => {
			const result = analyze(
				{ value: null, name: "{{name}}" },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					value: { type: "null" },
				},
				required: ["value"],
			});
		});

		test("object with number literal value → kept", () => {
			const result = analyze(
				{ score: 42, greeting: "Hello {{name}}" },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					score: { type: "integer" },
				},
				required: ["score"],
			});
		});

		test("mixed template (text + expression) in property value → excluded", () => {
			const result = analyze(
				{ greeting: "Hello {{name}}!", age: 25 },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					age: { type: "integer" },
				},
				required: ["age"],
			});
		});

		test("block helper expression in property value → excluded", () => {
			const result = analyze(
				{
					list: "{{#each tags}}{{this}}{{/each}}",
					label: "Tags",
				},
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					label: { type: "string" },
				},
				required: ["label"],
			});
		});
	});

	// ─── Nested objects ──────────────────────────────────────────────────────

	describe("nested objects", () => {
		test("nested object with templates → recursively filters at each level", () => {
			const result = analyze(
				{
					user: {
						name: "{{name}}",
						age: 30,
						city: "Paris",
					},
					status: "active",
				},
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: {
							age: { type: "integer" },
							city: { type: "string" },
						},
						required: ["age", "city"],
					},
					status: { type: "string" },
				},
				required: ["user", "status"],
			});
		});

		test("deeply nested object → filters at all levels", () => {
			const result = analyze(
				{
					level1: {
						level2: {
							static: "hello",
							dynamic: "{{name}}",
						},
						kept: 42,
					},
				},
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			const level1Props = (props?.level1 as JSONSchema7)?.properties as Record<
				string,
				JSONSchema7
			>;
			const level2Props = (level1Props?.level2 as JSONSchema7)
				?.properties as Record<string, JSONSchema7>;

			expect(level2Props).toHaveProperty("static");
			expect(level2Props).not.toHaveProperty("dynamic");
			expect(level1Props).toHaveProperty("kept");
		});
	});

	// ─── Arrays ──────────────────────────────────────────────────────────────

	describe("arrays", () => {
		test("array with mixed static and template elements → template elements excluded", () => {
			const result = analyze(["hello", "{{name}}", 42], userSchema, opts);
			expect(result.valid).toBe(true);
			// After filtering, the array should only contain "hello" and 42
			const schema = result.outputSchema;
			expect(schema.type).toBe("array");
		});

		test("array with all static elements → all kept", () => {
			const result = analyze(["hello", "world", 42], userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema.type).toBe("array");
		});

		test("array with all template elements → empty array", () => {
			const result = analyze(["{{name}}", "{{age}}"], userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema.type).toBe("array");
		});
	});

	// ─── Without the option (default behavior) ───────────────────────────────

	describe("without excludeTemplateExpression (default)", () => {
		test("object with templates → all properties included in schema", () => {
			const result = analyze({ name: "{{name}}", age: 30 }, userSchema);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).toHaveProperty("name");
			expect(props).toHaveProperty("age");
		});

		test("excludeTemplateExpression: false → same as default", () => {
			const result = analyze({ name: "{{name}}", age: 30 }, userSchema, {
				excludeTemplateExpression: false,
			});
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).toHaveProperty("name");
			expect(props).toHaveProperty("age");
		});
	});

	// ─── Typebars class ─────────────────────────────────────────────────────

	describe("Typebars.analyze()", () => {
		const tp = new Typebars();

		test("plain string → returns string schema", () => {
			const result = tp.analyze("Salut", userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("object with static values only → all properties kept", () => {
			const result = tp.analyze({ name: "Arthur" }, userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					name: { type: "string" },
				},
				required: ["name"],
			});
		});

		test("object with mixed values → template properties excluded", () => {
			const result = tp.analyze(
				{ name: "{{name}}", age: 30 },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					age: { type: "integer" },
				},
				required: ["age"],
			});
		});

		test("nested object → recursively excludes template properties", () => {
			const result = tp.analyze(
				{
					info: {
						label: "static",
						value: "{{name}}",
					},
					count: 5,
				},
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).toHaveProperty("info");
			expect(props).toHaveProperty("count");

			const infoProps = (props?.info as JSONSchema7)?.properties as Record<
				string,
				JSONSchema7
			>;
			expect(infoProps).toHaveProperty("label");
			expect(infoProps).not.toHaveProperty("value");
		});

		test("array with mixed elements → template elements excluded", () => {
			const result = tp.analyze(["static", "{{name}}", 100], userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema.type).toBe("array");
		});

		test("literal at root → returned as-is regardless of option", () => {
			const result = tp.analyze(42, userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("null at root → returned as-is regardless of option", () => {
			const result = tp.analyze(null, userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "null" });
		});

		test("boolean at root → returned as-is regardless of option", () => {
			const result = tp.analyze(true, userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});
	});

	// ─── CompiledTemplate ────────────────────────────────────────────────────

	describe("CompiledTemplate.analyze()", () => {
		const tp = new Typebars();

		test("compiled object template → excludes template properties", () => {
			const compiled = tp.compile({
				name: "{{name}}",
				age: 30,
				label: "fixed",
			});
			const result = compiled.analyze(userSchema, opts);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).not.toHaveProperty("name");
			expect(props).toHaveProperty("age");
			expect(props).toHaveProperty("label");
		});

		test("compiled object template without option → all properties included", () => {
			const compiled = tp.compile({
				name: "{{name}}",
				age: 30,
			});
			const result = compiled.analyze(userSchema);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).toHaveProperty("name");
			expect(props).toHaveProperty("age");
		});

		test("compiled array template → excludes template elements", () => {
			const compiled = tp.compile(["{{name}}", "static", 42]);
			const result = compiled.analyze(userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema.type).toBe("array");
		});

		test("compiled nested object → recursively filters", () => {
			const compiled = tp.compile({
				outer: {
					inner: "{{name}}",
					kept: "hello",
				},
			});
			const result = compiled.analyze(userSchema, opts);
			expect(result.valid).toBe(true);
			const outerProps = (
				(result.outputSchema.properties as Record<string, JSONSchema7>)
					?.outer as JSONSchema7
			)?.properties as Record<string, JSONSchema7>;
			expect(outerProps).toHaveProperty("kept");
			expect(outerProps).not.toHaveProperty("inner");
		});

		test("compiled literal template → unaffected by option", () => {
			const compiled = tp.compile(42);
			const result = compiled.analyze(userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("compiled string template at root → analyzed normally", () => {
			const compiled = tp.compile("{{name}}");
			const result = compiled.analyze(userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	// ─── Edge cases ──────────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("empty object → empty object schema", () => {
			const result = analyze({}, userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {},
				required: [],
			});
		});

		test("empty array → array schema", () => {
			const result = analyze([], userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema.type).toBe("array");
		});

		test("string containing {{ but not a valid expression → still treated as having expression", () => {
			// The check is based on the presence of `{{`, not on valid syntax.
			// Invalid syntax will be caught by the parser if analyzed.
			// But since we filter before analysis, we just skip it.
			const result = analyze(
				{ label: "price is {{ but broken", value: 10 },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			// "label" contains `{{` so it's excluded
			expect(props).not.toHaveProperty("label");
			expect(props).toHaveProperty("value");
		});

		test("string with escaped-looking braces → excluded if contains {{", () => {
			const result = analyze({ msg: "\\{{name}}", count: 1 }, userSchema, opts);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).not.toHaveProperty("msg");
			expect(props).toHaveProperty("count");
		});

		test("empty string value → kept (no expression)", () => {
			const result = analyze(
				{ empty: "", template: "{{name}}" },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).toHaveProperty("empty");
			expect(props).not.toHaveProperty("template");
		});

		test("diagnostics are clean when template properties are excluded", () => {
			// Even if the excluded template has an invalid expression,
			// it should not generate diagnostics because it's skipped entirely.
			const result = analyze(
				{ bad: "{{nonExistentProp}}", good: 42 },
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					good: { type: "integer" },
				},
				required: ["good"],
			});
		});

		test("without excludeTemplateExpression, invalid template property generates diagnostics", () => {
			const result = analyze(
				{ bad: "{{nonExistentProp}}", good: 42 },
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.length).toBeGreaterThan(0);
		});
	});

	// ─── Combined with other options ─────────────────────────────────────────

	describe("combined with other options", () => {
		test("excludeTemplateExpression + coerceSchema → both applied", () => {
			const result = analyze({ amount: "123", name: "{{name}}" }, userSchema, {
				excludeTemplateExpression: true,
				coerceSchema: {
					type: "object",
					properties: {
						amount: { type: "string" },
					},
				},
			});
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).not.toHaveProperty("name");
			expect(props).toHaveProperty("amount");
			// coerceSchema says amount is "string", so it should stay string
			// with the actual literal value as const
			expect(props?.amount).toEqual({ type: "string", const: "123" });
		});

		test("excludeTemplateExpression + identifierSchemas → identifiers in excluded props are skipped", () => {
			const idSchema: JSONSchema7 = {
				type: "object",
				properties: {
					meetingId: { type: "string" },
				},
			};
			const result = analyze(
				{ id: "{{meetingId:1}}", label: "Meeting" },
				userSchema,
				{
					excludeTemplateExpression: true,
					identifierSchemas: { 1: idSchema },
				},
			);
			expect(result.valid).toBe(true);
			const props = result.outputSchema.properties as Record<
				string,
				JSONSchema7
			>;
			expect(props).not.toHaveProperty("id");
			expect(props).toHaveProperty("label");
			// No diagnostics — the template property with identifier was skipped
			expect(result.diagnostics).toEqual([]);
		});
	});

	// ─── Typebars.validate() ─────────────────────────────────────────────────

	describe("Typebars.validate()", () => {
		const tp = new Typebars();

		test("validate with excludeTemplateExpression skips template properties", () => {
			const result = tp.validate(
				{ bad: "{{nonExistentProp}}", good: 42 },
				userSchema,
				opts,
			);
			// Since the template property is excluded, no diagnostics are generated
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});
	});

	// ─── Typebars.execute() — runtime ────────────────────────────────────────

	describe("Typebars.execute() — runtime", () => {
		const tp = new Typebars();
		const execOpts = { excludeTemplateExpression: true } as const;
		const data = { name: "Alice", age: 30, city: "Paris" };

		// ── Objects ───────────────────────────────────────────────────────────

		test("object with mixed static and template values → template properties removed", () => {
			const result = tp.execute(
				{ name: "{{name}}", value: 42 },
				data,
				execOpts,
			);
			expect(result).toEqual({ value: 42 });
		});

		test("object with only static values → all properties kept", () => {
			const result = tp.execute({ label: "hello", count: 10 }, data, execOpts);
			expect(result).toEqual({ label: "hello", count: 10 });
		});

		test("object where all values are templates → empty object", () => {
			const result = tp.execute(
				{ name: "{{name}}", city: "{{city}}" },
				data,
				execOpts,
			);
			expect(result).toEqual({});
		});

		test("object with boolean literal → kept", () => {
			const result = tp.execute(
				{ active: true, name: "{{name}}" },
				data,
				execOpts,
			);
			expect(result).toEqual({ active: true });
		});

		test("object with null literal → kept", () => {
			const result = tp.execute(
				{ value: null, name: "{{name}}" },
				data,
				execOpts,
			);
			expect(result).toEqual({ value: null });
		});

		test("object with number literal → kept", () => {
			const result = tp.execute(
				{ score: 95, greeting: "{{name}}" },
				data,
				execOpts,
			);
			expect(result).toEqual({ score: 95 });
		});

		test("mixed template (text + expression) in property value → excluded", () => {
			const result = tp.execute(
				{ greeting: "Hello {{name}}", age: 30 },
				data,
				execOpts,
			);
			expect(result).toEqual({ age: 30 });
		});

		test("block helper expression in property value → excluded", () => {
			const result = tp.execute(
				{
					list: "{{#each tags}}{{this}}{{/each}}",
					label: "static",
				},
				data,
				execOpts,
			);
			expect(result).toEqual({ label: "static" });
		});

		// ── Arrays ────────────────────────────────────────────────────────────

		test("array with mixed static and template elements → template elements removed", () => {
			const result = tp.execute(["hello", "{{name}}"], data, execOpts);
			expect(result).toEqual(["hello"]);
		});

		test("array with all static elements → all kept", () => {
			const result = tp.execute(["hello", "world", 42], data, execOpts);
			expect(result).toEqual(["hello", "world", 42]);
		});

		test("array with all template elements → empty array", () => {
			const result = tp.execute(["{{name}}", "{{city}}"], data, execOpts);
			expect(result).toEqual([]);
		});

		test("array with mixed types including literals → only non-template kept", () => {
			const result = tp.execute(
				[true, "{{name}}", null, "static", 10],
				data,
				execOpts,
			);
			expect(result).toEqual([true, null, "static", 10]);
		});

		// ── Root string ──────────────────────────────────────────────────────

		test("root string with expression → returns null", () => {
			const result = tp.execute("{{name}}", data, execOpts);
			expect(result).toBeNull();
		});

		test("root mixed template → returns null", () => {
			const result = tp.execute("Hello {{name}}", data, execOpts);
			expect(result).toBeNull();
		});

		test("root plain string (no expression) → returned as-is", () => {
			const result = tp.execute("hello", data, execOpts);
			expect(result).toBe("hello");
		});

		// ── Literals at root ─────────────────────────────────────────────────

		test("number literal at root → returned as-is", () => {
			const result = tp.execute(42, data, execOpts);
			expect(result).toBe(42);
		});

		test("boolean literal at root → returned as-is", () => {
			const result = tp.execute(true, data, execOpts);
			expect(result).toBe(true);
		});

		test("null at root → returned as-is", () => {
			const result = tp.execute(null, data, execOpts);
			expect(result).toBeNull();
		});

		// ── Nested objects ────────────────────────────────────────────────────

		test("nested object with templates → recursively filters at each level", () => {
			const result = tp.execute(
				{
					user: {
						name: "{{name}}",
						age: 30,
						city: "Paris",
					},
					status: "{{active}}",
				},
				data,
				execOpts,
			);
			expect(result).toEqual({
				user: {
					age: 30,
					city: "Paris",
				},
			});
		});

		test("deeply nested object → filters at all levels", () => {
			const result = tp.execute(
				{
					level1: {
						level2: {
							static: "kept",
							dynamic: "{{name}}",
						},
						kept: 42,
					},
				},
				data,
				execOpts,
			);
			expect(result).toEqual({
				level1: {
					level2: {
						static: "kept",
					},
					kept: 42,
				},
			});
		});

		// ── Without option (default behavior) ────────────────────────────────

		test("without excludeTemplateExpression → templates are executed normally", () => {
			const result = tp.execute({ name: "{{name}}", value: 42 }, data);
			expect(result).toEqual({ name: "Alice", value: 42 });
		});

		test("excludeTemplateExpression: false → same as default", () => {
			const result = tp.execute({ name: "{{name}}", value: 42 }, data, {
				excludeTemplateExpression: false,
			});
			expect(result).toEqual({ name: "Alice", value: 42 });
		});

		// ── Edge cases ───────────────────────────────────────────────────────

		test("empty object → empty object", () => {
			const result = tp.execute({}, data, execOpts);
			expect(result).toEqual({});
		});

		test("empty array → empty array", () => {
			const result = tp.execute([], data, execOpts);
			expect(result).toEqual([]);
		});

		test("empty string value → kept (no expression)", () => {
			const result = tp.execute(
				{ empty: "", template: "{{name}}" },
				data,
				execOpts,
			);
			expect(result).toEqual({ empty: "" });
		});

		test("string containing {{ but not valid expression → still excluded", () => {
			const result = tp.execute(
				{ label: "Use {{ syntax", value: 42 },
				data,
				execOpts,
			);
			// The heuristic detects `{{` and excludes it
			expect(result).toEqual({ value: 42 });
		});

		test("combined with coerceSchema → both applied", () => {
			const result = tp.execute({ amount: "123", name: "{{name}}" }, data, {
				excludeTemplateExpression: true,
				coerceSchema: {
					type: "object",
					properties: {
						amount: { type: "number" },
					},
				},
			});
			expect(result).toEqual({ amount: 123 });
		});
	});

	// ─── CompiledTemplate.execute() — runtime ────────────────────────────────

	describe("CompiledTemplate.execute() — runtime", () => {
		const tp = new Typebars();
		const execOpts = { excludeTemplateExpression: true } as const;
		const data = { name: "Alice", age: 30, city: "Paris" };

		test("compiled object template → excludes template properties", () => {
			const compiled = tp.compile({
				name: "{{name}}",
				age: 30,
				label: "static",
			});
			const result = compiled.execute(data, execOpts);
			expect(result).toEqual({ age: 30, label: "static" });
		});

		test("compiled object template without option → all properties included", () => {
			const compiled = tp.compile({
				name: "{{name}}",
				age: 30,
			});
			const result = compiled.execute(data);
			expect(result).toEqual({ name: "Alice", age: 30 });
		});

		test("compiled array template → excludes template elements", () => {
			const compiled = tp.compile(["hello", "{{name}}"]);
			const result = compiled.execute(data, execOpts);
			expect(result).toEqual(["hello"]);
		});

		test("compiled nested object → recursively filters", () => {
			const compiled = tp.compile({
				outer: {
					inner: "{{name}}",
					kept: 42,
				},
			});
			const result = compiled.execute(data, execOpts);
			expect(result).toEqual({ outer: { kept: 42 } });
		});

		test("compiled literal template → unaffected by option", () => {
			const compiled = tp.compile(42);
			const result = compiled.execute(data, execOpts);
			expect(result).toBe(42);
		});

		test("compiled string template at root with expression → returns null", () => {
			const compiled = tp.compile("{{name}}");
			const result = compiled.execute(data, execOpts);
			expect(result).toBeNull();
		});

		test("compiled string template at root without expression → returned as-is", () => {
			const compiled = tp.compile("hello");
			const result = compiled.execute(data, execOpts);
			expect(result).toBe("hello");
		});
	});
});
