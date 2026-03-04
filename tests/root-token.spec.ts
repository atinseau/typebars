import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { Typebars } from "../src";
import { ROOT_TOKEN } from "../src/parser.ts";
import { userData, userSchema } from "./fixtures.ts";

// ─── $root Token Tests ───────────────────────────────────────────────────────
// The `$root` token allows referencing the entire input schema / data context
// directly. This is useful when the inputSchema is a primitive type (e.g.
// `{ type: "string" }`) rather than an object with properties.
//
// Rules:
//   `{{ $root }}`       → resolves to the entire root context value / schema
//   `{{ $root.foo }}`   → FORBIDDEN — path traversal on $root is not allowed.
//                          Use `{{ foo }}` instead (properties are already
//                          available in the context).

describe("$root token", () => {
	const tp = new Typebars();

	// ─── Constant ────────────────────────────────────────────────────────────

	describe("ROOT_TOKEN constant", () => {
		test("ROOT_TOKEN equals '$root'", () => {
			expect(ROOT_TOKEN).toBe("$root");
		});
	});

	// ─── Analysis ────────────────────────────────────────────────────────────

	describe("analyze", () => {
		describe("primitive inputSchema", () => {
			test("{{ $root }} with string schema → valid, outputSchema is string", () => {
				const result = tp.analyze("{{ $root }}", { type: "string" });
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "string" });
			});

			test("{{ $root }} with number schema → valid, outputSchema is number", () => {
				const result = tp.analyze("{{ $root }}", { type: "number" });
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "number" });
			});

			test("{{ $root }} with boolean schema → valid, outputSchema is boolean", () => {
				const result = tp.analyze("{{ $root }}", { type: "boolean" });
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "boolean" });
			});

			test("{{ $root }} with integer schema → valid, outputSchema is integer", () => {
				const result = tp.analyze("{{ $root }}", { type: "integer" });
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "integer" });
			});

			test("{{ $root }} with null schema → valid, outputSchema is null", () => {
				const result = tp.analyze("{{ $root }}", { type: "null" });
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "null" });
			});
		});

		describe("object inputSchema", () => {
			test("{{ $root }} with object schema → valid, returns entire object schema", () => {
				const result = tp.analyze("{{ $root }}", userSchema);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual(userSchema);
			});
		});

		describe("array inputSchema", () => {
			test("{{ $root }} with array schema → valid, returns entire array schema", () => {
				const schema: JSONSchema7 = {
					type: "array",
					items: { type: "string" },
				};
				const result = tp.analyze("{{ $root }}", schema);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual(schema);
			});
		});

		describe("object template with $root", () => {
			test("object template referencing $root for primitive schema → valid", () => {
				const result = tp.analyze({ name: "{{ $root }}" }, { type: "string" });
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						name: { type: "string" },
					},
					required: ["name"],
				});
			});

			test("object template referencing $root for number schema → valid", () => {
				const result = tp.analyze({ value: "{{ $root }}" }, { type: "number" });
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						value: { type: "number" },
					},
					required: ["value"],
				});
			});

			test("object template mixing $root and regular property → valid", () => {
				const result = tp.analyze(
					{
						fullValue: "{{ $root }}",
						direct: "{{ age }}",
					},
					userSchema,
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						fullValue: userSchema,
						direct: { type: "number" },
					},
					required: ["fullValue", "direct"],
				});
			});
		});

		// ─── Path Traversal is FORBIDDEN ─────────────────────────────────────
		// $root.name, $root.foo, $root.address.city are ALL invalid.
		// Use {{ name }}, {{ foo }}, {{ address.city }} instead.

		describe("path traversal is forbidden (ROOT_PATH_TRAVERSAL)", () => {
			test("{{ $root.name }} with object schema → error ROOT_PATH_TRAVERSAL", () => {
				const result = tp.analyze("{{ $root.name }}", userSchema);
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
				expect(result.diagnostics[0]?.details?.path).toBe("$root.name");
			});

			test("{{ $root.age }} with object schema → error ROOT_PATH_TRAVERSAL", () => {
				const result = tp.analyze("{{ $root.age }}", userSchema);
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
			});

			test("{{ $root.address.city }} with object schema → error ROOT_PATH_TRAVERSAL", () => {
				const result = tp.analyze("{{ $root.address.city }}", userSchema);
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
				expect(result.diagnostics[0]?.details?.path).toBe("$root.address.city");
			});

			test("{{ $root.foo }} with primitive schema → error ROOT_PATH_TRAVERSAL", () => {
				const result = tp.analyze("{{ $root.foo }}", { type: "string" });
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
			});

			test("{{ $root.nonexistent }} with object schema → error ROOT_PATH_TRAVERSAL (not UNKNOWN_PROPERTY)", () => {
				const result = tp.analyze("{{ $root.nonexistent }}", userSchema);
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				// The error code is ROOT_PATH_TRAVERSAL, NOT UNKNOWN_PROPERTY.
				// The path traversal check happens before property resolution.
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
			});

			test("error message suggests using the property directly", () => {
				const result = tp.analyze("{{ $root.name }}", userSchema);
				expect(result.valid).toBe(false);
				const message = result.diagnostics[0]?.message ?? "";
				// The message should suggest using {{ name }} instead
				expect(message).toContain("name");
				expect(message).toContain("$root");
			});

			test("object template with $root.name → error ROOT_PATH_TRAVERSAL", () => {
				const result = tp.analyze(
					{ displayName: "{{ $root.name }}" },
					userSchema,
				);
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
			});

			test("mixed template with $root.name → error ROOT_PATH_TRAVERSAL", () => {
				const result = tp.analyze("Hello {{ $root.name }}!", userSchema);
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
			});
		});

		describe("mixed template (string concatenation)", () => {
			test("text + $root expression → string output", () => {
				const result = tp.analyze("Value is: {{ $root }}", {
					type: "string",
				});
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string" });
			});
		});

		describe("$root inside block helpers", () => {
			test("$root used as #if condition → valid", () => {
				const result = tp.analyze("{{#if $root}}yes{{/if}}", {
					type: "boolean",
				});
				expect(result.valid).toBe(true);
			});

			test("$root.active used as #if condition → error ROOT_PATH_TRAVERSAL", () => {
				const result = tp.analyze(
					"{{#if $root.active}}active{{else}}inactive{{/if}}",
					userSchema,
				);
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
			});
		});
	});

	// ─── Execution ───────────────────────────────────────────────────────────

	describe("execute", () => {
		describe("single expression (fast path — type-preserving)", () => {
			test("{{ $root }} returns the entire data context", () => {
				const data = { name: "Alice", age: 30 };
				const result = tp.execute("{{ $root }}", data);
				expect(result).toEqual(data);
			});

			test("{{ $root }} preserves object identity", () => {
				const data = { x: 1, y: [2, 3] };
				const result = tp.execute("{{ $root }}", data);
				expect(result).toEqual(data);
			});

			test("{{ $root }} with nested data → returns entire object", () => {
				const result = tp.execute("{{ $root }}", userData);
				expect(result).toEqual(userData);
			});
		});

		describe("$root.x is silently undefined at execution time", () => {
			// At execution time, $root.x returns undefined because
			// the analyzer already rejects it. If someone bypasses
			// the analyzer, execution is still safe (no crash).
			test("{{ $root.name }} → undefined (path traversal not supported)", () => {
				const result = tp.execute("{{ $root.name }}", userData);
				expect(result).toBeUndefined();
			});

			test("{{ $root.age }} → undefined (path traversal not supported)", () => {
				const result = tp.execute("{{ $root.age }}", userData);
				expect(result).toBeUndefined();
			});

			test("{{ $root.address.city }} → undefined (path traversal not supported)", () => {
				const result = tp.execute("{{ $root.address.city }}", userData);
				expect(result).toBeUndefined();
			});
		});

		describe("mixed template (string concatenation)", () => {
			test("text + $root expression → concatenated string", () => {
				const data = { name: "Alice" };
				const result = tp.execute("Data: {{ $root }}", data);
				// Handlebars converts the object to string ([object Object])
				expect(result).toBe("Data: [object Object]");
			});
		});

		describe("object template", () => {
			test("object template with $root → returns entire data in each property", () => {
				const data = { name: "Alice", age: 30 };
				const result = tp.execute(
					{
						everything: "{{ $root }}",
					},
					data,
				);
				expect(result).toEqual({
					everything: data,
				});
			});

			test("object template mixing $root and regular property", () => {
				const result = tp.execute(
					{
						full: "{{ $root }}",
						direct: "{{ name }}",
					},
					userData,
				);
				expect(result).toEqual({
					full: userData,
					direct: "Alice",
				});
			});
		});

		describe("block helpers", () => {
			test("$root as #if condition (truthy data) → renders then branch", () => {
				const data = { value: "hello" };
				const result = tp.execute("{{#if $root}}yes{{else}}no{{/if}}", data);
				expect(result).toBe("yes");
			});

			test("$root inside #each refers to root context via Handlebars merge", () => {
				// Inside #each, $root is available via the merged data.
				// Since $root references the entire data, it renders as [object Object]
				// in string context.
				const data = { items: ["a", "b"], label: "test" };
				const result = tp.execute("{{#each items}}{{this}} {{/each}}", data);
				expect(result).toBe("a b ");
			});
		});
	});

	// ─── analyzeAndExecute ───────────────────────────────────────────────────

	describe("analyzeAndExecute", () => {
		test("$root with primitive schema → valid analysis + correct execution", () => {
			const schema: JSONSchema7 = { type: "string" };
			const data = { greeting: "hello" };
			const result = tp.analyzeAndExecute(
				{ name: "{{ $root }}" },
				schema,
				data,
			);
			expect(result.analysis.valid).toBe(true);
			expect(result.analysis.outputSchema).toEqual({
				type: "object",
				properties: {
					name: { type: "string" },
				},
				required: ["name"],
			});
			// At execution, $root returns the entire data
			expect(result.value).toEqual({ name: data });
		});

		test("$root with object schema → valid analysis + correct execution", () => {
			const result = tp.analyzeAndExecute(
				{ everything: "{{ $root }}" },
				userSchema,
				userData,
			);
			expect(result.analysis.valid).toBe(true);
			expect(result.analysis.outputSchema).toEqual({
				type: "object",
				properties: {
					everything: userSchema,
				},
				required: ["everything"],
			});
			expect(result.value).toEqual({ everything: userData });
		});

		test("$root.name in analyzeAndExecute → invalid (ROOT_PATH_TRAVERSAL), value is undefined", () => {
			const result = tp.analyzeAndExecute(
				{ displayName: "{{ $root.name }}" },
				userSchema,
				userData,
			);
			expect(result.analysis.valid).toBe(false);
			expect(result.analysis.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
			// When analysis fails, value should be undefined
			expect(result.value).toBeUndefined();
		});
	});

	// ─── validate ────────────────────────────────────────────────────────────

	describe("validate", () => {
		test("{{ $root }} with string schema → valid", () => {
			const result = tp.validate("{{ $root }}", { type: "string" });
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("{{ $root }} with object schema → valid", () => {
			const result = tp.validate("{{ $root }}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("{{ $root.nonexistent }} with string schema → invalid (ROOT_PATH_TRAVERSAL)", () => {
			const result = tp.validate("{{ $root.nonexistent }}", {
				type: "string",
			});
			expect(result.valid).toBe(false);
			expect(result.diagnostics.length).toBeGreaterThan(0);
			expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
		});

		test("{{ $root.name }} with object schema → invalid (ROOT_PATH_TRAVERSAL)", () => {
			const result = tp.validate("{{ $root.name }}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
		});
	});

	// ─── Edge Cases ──────────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("{{ $root }} with empty object schema → valid", () => {
			const result = tp.analyze("{{ $root }}", {});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({});
		});

		test("$root is not confused with properties named '$root'", () => {
			// If the schema has a property literally named "$root", regular
			// path resolution would find it. But `$root` as the first segment
			// should resolve to the root context, not a property named "$root".
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					$root: { type: "number" },
					name: { type: "string" },
				},
			};
			// {{ $root }} should return the entire schema, not the $root property
			const result = tp.analyze("{{ $root }}", schema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual(schema);
		});

		test("$root resolves correctly even with surrounding whitespace", () => {
			const result = tp.analyze("  {{ $root }}  ", { type: "number" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("$root execution with missing nested path → undefined (no crash)", () => {
			const result = tp.execute("{{ $root.nonexistent }}", userData);
			expect(result).toBeUndefined();
		});

		test("$root execution with deeply missing path → undefined (no crash)", () => {
			const result = tp.execute("{{ $root.a.b.c }}", userData);
			expect(result).toBeUndefined();
		});

		test("{{ $root }} in array template → each element uses the same root schema", () => {
			const result = tp.analyze(["{{ $root }}", "{{ name }}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [userSchema, { type: "string" }],
				},
			});
		});

		test("{{ $root }} combined with regular properties in array template", () => {
			const result = tp.analyze(["{{ $root }}", "{{ age }}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [userSchema, { type: "number" }],
				},
			});
		});

		test("{{ $root }} with oneOf schema → valid, returns oneOf schema", () => {
			const schema: JSONSchema7 = {
				oneOf: [{ type: "string" }, { type: "number" }],
			};
			const result = tp.analyze("{{ $root }}", schema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual(schema);
		});

		test("{{ $root }} with anyOf schema → valid, returns anyOf schema", () => {
			const schema: JSONSchema7 = {
				anyOf: [{ type: "string" }, { type: "boolean" }],
			};
			const result = tp.analyze("{{ $root }}", schema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual(schema);
		});
	});

	// ─── Compiled Template ───────────────────────────────────────────────────

	describe("CompiledTemplate", () => {
		test("compiled template with {{ $root }} → returns entire data", () => {
			const compiled = tp.compile("{{ $root }}");
			const data = { name: "Alice", age: 30 };
			const result = compiled.execute(data);
			expect(result).toEqual(data);
		});

		test("compiled template with $root in object → returns entire data for that key", () => {
			const compiled = tp.compile({ everything: "{{ $root }}" });
			const data = { name: "Alice", age: 30 };
			const result = compiled.execute(data);
			expect(result).toEqual({ everything: data });
		});

		test("compiled template with $root.name → undefined (path traversal not supported)", () => {
			const compiled = tp.compile("{{ $root.name }}");
			const result = compiled.execute(userData);
			expect(result).toBeUndefined();
		});
	});
});
