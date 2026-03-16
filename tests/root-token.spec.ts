import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { Typebars } from "../src";
import {
	isRootPathTraversal,
	isRootSegments,
	ROOT_TOKEN,
} from "../src/parser.ts";
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
				minItems: 2,
				maxItems: 2,
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
				minItems: 2,
				maxItems: 2,
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

		test("compiled template with {{ $root }} and primitive data → returns primitive", () => {
			const compiled = tp.compile("{{ $root }}");
			expect(compiled.execute(42)).toBe(42);
			expect(compiled.execute("hello")).toBe("hello");
			expect(compiled.execute(true)).toBe(true);
			expect(compiled.execute(null)).toBeNull();
		});
	});

	// ─── Primitive Data (TemplateData) ────────────────────────────────────────
	// The `data` parameter accepts primitive values (number, string, boolean,
	// null, array) in addition to `Record<string, unknown>`. This is useful
	// when the entire data context is a single value accessed via `{{$root}}`.

	describe("primitive data (TemplateData)", () => {
		describe("execute with primitive data", () => {
			test("{{ $root }} with number data → returns number", () => {
				const result = tp.execute("{{ $root }}", 10);
				expect(result).toBe(10);
				expect(typeof result).toBe("number");
			});

			test("{{ $root }} with string data → returns string", () => {
				const result = tp.execute("{{ $root }}", "hello");
				expect(result).toBe("hello");
				expect(typeof result).toBe("string");
			});

			test("{{ $root }} with boolean data → returns boolean", () => {
				const result = tp.execute("{{ $root }}", true);
				expect(result).toBe(true);
				expect(typeof result).toBe("boolean");
			});

			test("{{ $root }} with null data → returns null", () => {
				const result = tp.execute("{{ $root }}", null);
				expect(result).toBeNull();
			});

			test("{{ $root }} with array data → returns array", () => {
				const arr = [1, 2, 3];
				const result = tp.execute("{{ $root }}", arr);
				expect(result).toEqual(arr);
			});

			test("{{ $root }} with float data → returns float", () => {
				const result = tp.execute("{{ $root }}", 3.14);
				expect(result).toBe(3.14);
			});

			test("{{ $root }} with negative number data → returns negative number", () => {
				const result = tp.execute("{{ $root }}", -99);
				expect(result).toBe(-99);
			});

			test("{{ $root }} with zero data → returns 0", () => {
				const result = tp.execute("{{ $root }}", 0);
				expect(result).toBe(0);
			});

			test("{{ $root }} with empty string data → returns empty string", () => {
				const result = tp.execute("{{ $root }}", "");
				expect(result).toBe("");
			});
		});

		describe("object template with primitive data", () => {
			test("object template referencing $root with number data → wraps value", () => {
				const result = tp.execute({ value: "{{ $root }}" }, 42);
				expect(result).toEqual({ value: 42 });
			});

			test("object template referencing $root with string data → wraps value", () => {
				const result = tp.execute({ label: "{{ $root }}" }, "hello");
				expect(result).toEqual({ label: "hello" });
			});
		});

		describe("analyzeAndExecute with primitive data", () => {
			test("{{ $root }} with number schema and number data → valid + returns number", () => {
				const { analysis, value } = tp.analyzeAndExecute(
					"{{ $root }}",
					{ type: "number" },
					42,
				);
				expect(analysis.valid).toBe(true);
				expect(analysis.outputSchema).toEqual({ type: "number" });
				expect(value).toBe(42);
			});

			test("{{ $root }} with string schema and string data → valid + returns string", () => {
				const { analysis, value } = tp.analyzeAndExecute(
					"{{ $root }}",
					{ type: "string" },
					"world",
				);
				expect(analysis.valid).toBe(true);
				expect(analysis.outputSchema).toEqual({ type: "string" });
				expect(value).toBe("world");
			});

			test("{{ $root }} with boolean schema and boolean data → valid + returns boolean", () => {
				const { analysis, value } = tp.analyzeAndExecute(
					"{{ $root }}",
					{ type: "boolean" },
					true,
				);
				expect(analysis.valid).toBe(true);
				expect(analysis.outputSchema).toEqual({ type: "boolean" });
				expect(value).toBe(true);
			});

			test("object template with $root and primitive data → valid + returns wrapped value", () => {
				const { analysis, value } = tp.analyzeAndExecute(
					{ amount: "{{ $root }}" },
					{ type: "number" },
					99,
				);
				expect(analysis.valid).toBe(true);
				expect(value).toEqual({ amount: 99 });
			});
		});

		describe("CompiledTemplate with primitive data", () => {
			test("compiled {{ $root }} with number data → returns number", () => {
				const compiled = tp.compile("{{ $root }}");
				expect(compiled.execute(10)).toBe(10);
			});

			test("compiled {{ $root }} with string data → returns string", () => {
				const compiled = tp.compile("{{ $root }}");
				expect(compiled.execute("test")).toBe("test");
			});

			test("compiled object template with $root and primitive data → wraps value", () => {
				const compiled = tp.compile({ val: "{{ $root }}" });
				expect(compiled.execute(7)).toEqual({ val: 7 });
			});

			test("compiled analyzeAndExecute with primitive data → valid + returns value", () => {
				const compiled = tp.compile("{{ $root }}");
				const { analysis, value } = compiled.analyzeAndExecute(
					{ type: "number" },
					55,
				);
				expect(analysis.valid).toBe(true);
				expect(analysis.outputSchema).toEqual({ type: "number" });
				expect(value).toBe(55);
			});
		});

		describe("path resolution with primitive data → undefined", () => {
			test("{{ name }} with number data → undefined (no properties on primitive)", () => {
				const result = tp.execute("{{ name }}", 42);
				expect(result).toBeUndefined();
			});

			test("{{ foo.bar }} with string data → undefined", () => {
				const result = tp.execute("{{ foo.bar }}", "hello");
				expect(result).toBeUndefined();
			});
		});
	});

	// ─── $root:N — Identifier Support ────────────────────────────────────────
	// The `$root:N` syntax allows referencing the **entire** data/schema of
	// identifier N, just like `$root` references the entire input data/schema.
	//
	// Rules:
	//   `{{ $root:N }}`     → resolves to the entire identifier N context
	//   `{{ $root.foo:N }}` → FORBIDDEN — path traversal on $root is not allowed

	describe("isRootSegments / isRootPathTraversal helpers", () => {
		test("isRootSegments(['$root']) → true", () => {
			expect(isRootSegments(["$root"])).toBe(true);
		});

		test("isRootSegments(['$root', 'name']) → false (path traversal)", () => {
			expect(isRootSegments(["$root", "name"])).toBe(false);
		});

		test("isRootSegments(['name']) → false", () => {
			expect(isRootSegments(["name"])).toBe(false);
		});

		test("isRootSegments([]) → false", () => {
			expect(isRootSegments([])).toBe(false);
		});

		test("isRootPathTraversal(['$root', 'name']) → true", () => {
			expect(isRootPathTraversal(["$root", "name"])).toBe(true);
		});

		test("isRootPathTraversal(['$root']) → false", () => {
			expect(isRootPathTraversal(["$root"])).toBe(false);
		});

		test("isRootPathTraversal(['name', 'foo']) → false", () => {
			expect(isRootPathTraversal(["name", "foo"])).toBe(false);
		});
	});

	describe("analyze with $root:N", () => {
		describe("primitive identifierSchemas", () => {
			test("{{ $root:2 }} with id 2 = string → valid, outputSchema is string", () => {
				const result = tp.analyze(
					"{{ $root:2 }}",
					{ type: "number" },
					{
						identifierSchemas: { 2: { type: "string" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "string" });
			});

			test("{{ $root:1 }} with id 1 = number → valid, outputSchema is number", () => {
				const result = tp.analyze(
					"{{ $root:1 }}",
					{ type: "string" },
					{
						identifierSchemas: { 1: { type: "number" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "number" });
			});

			test("{{ $root:0 }} with id 0 = boolean → valid, outputSchema is boolean", () => {
				const result = tp.analyze(
					"{{ $root:0 }}",
					{ type: "string" },
					{
						identifierSchemas: { 0: { type: "boolean" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "boolean" });
			});

			test("{{ $root:3 }} with id 3 = integer → valid, outputSchema is integer", () => {
				const result = tp.analyze(
					"{{ $root:3 }}",
					{ type: "string" },
					{
						identifierSchemas: { 3: { type: "integer" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "integer" });
			});

			test("{{ $root:1 }} with id 1 = null → valid, outputSchema is null", () => {
				const result = tp.analyze(
					"{{ $root:1 }}",
					{ type: "string" },
					{
						identifierSchemas: { 1: { type: "null" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "null" });
			});
		});

		describe("object/array identifierSchemas", () => {
			test("{{ $root:1 }} with id 1 = object schema → valid, returns entire object schema", () => {
				const idSchema: JSONSchema7 = {
					type: "object",
					properties: {
						name: { type: "string" },
						age: { type: "number" },
					},
				};
				const result = tp.analyze(
					"{{ $root:1 }}",
					{ type: "string" },
					{
						identifierSchemas: { 1: idSchema },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual(idSchema);
			});

			test("{{ $root:2 }} with id 2 = array schema → valid, returns entire array schema", () => {
				const idSchema: JSONSchema7 = {
					type: "array",
					items: { type: "string" },
				};
				const result = tp.analyze(
					"{{ $root:2 }}",
					{ type: "number" },
					{
						identifierSchemas: { 2: idSchema },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual(idSchema);
			});
		});

		describe("$root:N does NOT affect plain $root", () => {
			test("{{ $root }} still returns inputSchema when identifierSchemas are present", () => {
				const result = tp.analyze(
					"{{ $root }}",
					{ type: "number" },
					{
						identifierSchemas: { 1: { type: "string" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({ type: "number" });
			});
		});

		describe("object template with $root:N", () => {
			test("object template referencing $root:1 for primitive identifier schema → valid", () => {
				const result = tp.analyze(
					{ value: "{{ $root:1 }}" },
					{ type: "string" },
					{ identifierSchemas: { 1: { type: "number" } } },
				);
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

			test("object template mixing $root:N and regular property → valid", () => {
				const result = tp.analyze(
					{
						fromIdentifier: "{{ $root:1 }}",
						fromInput: "{{ name }}",
					},
					userSchema,
					{ identifierSchemas: { 1: { type: "boolean" } } },
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						fromIdentifier: { type: "boolean" },
						fromInput: { type: "string" },
					},
					required: ["fromIdentifier", "fromInput"],
				});
			});

			test("object template mixing $root and $root:N → valid", () => {
				const result = tp.analyze(
					{
						entire: "{{ $root }}",
						idValue: "{{ $root:2 }}",
					},
					{ type: "number" },
					{ identifierSchemas: { 2: { type: "string" } } },
				);
				expect(result.valid).toBe(true);
				expect(result.diagnostics).toHaveLength(0);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						entire: { type: "number" },
						idValue: { type: "string" },
					},
					required: ["entire", "idValue"],
				});
			});
		});

		describe("mixed template with $root:N", () => {
			test("text + $root:N expression → string output", () => {
				const result = tp.analyze(
					"Hello {{ $root:1 }}",
					{ type: "number" },
					{ identifierSchemas: { 1: { type: "string" } } },
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string" });
			});

			test("mixing regular prop + $root:N in mixed template → valid", () => {
				const result = tp.analyze("{{ name }} is {{ $root:1 }}", userSchema, {
					identifierSchemas: { 1: { type: "boolean" } },
				});
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string" });
			});
		});

		describe("error cases", () => {
			test("{{ $root:2 }} without identifierSchemas → MISSING_IDENTIFIER_SCHEMAS", () => {
				const result = tp.analyze("{{ $root:2 }}", { type: "number" });
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("MISSING_IDENTIFIER_SCHEMAS");
			});

			test("{{ $root:99 }} with missing identifier → UNKNOWN_IDENTIFIER", () => {
				const result = tp.analyze(
					"{{ $root:99 }}",
					{ type: "number" },
					{
						identifierSchemas: { 1: { type: "string" } },
					},
				);
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("UNKNOWN_IDENTIFIER");
			});

			test("{{ $root.name:2 }} → ROOT_PATH_TRAVERSAL (path traversal still forbidden)", () => {
				const result = tp.analyze("{{ $root.name:2 }}", userSchema, {
					identifierSchemas: { 2: userSchema },
				});
				expect(result.valid).toBe(false);
				expect(result.diagnostics).toHaveLength(1);
				expect(result.diagnostics[0]?.code).toBe("ROOT_PATH_TRAVERSAL");
			});
		});

		describe("$root:N inside block helpers", () => {
			test("$root:1 used as #if condition → valid", () => {
				const result = tp.analyze(
					"{{#if $root:1}}yes{{/if}}",
					{ type: "number" },
					{ identifierSchemas: { 1: { type: "boolean" } } },
				);
				expect(result.valid).toBe(true);
			});
		});
	});

	describe("execute with $root:N", () => {
		describe("single expression (type-preserving)", () => {
			test("{{ $root:2 }} returns entire identifierData[2]", () => {
				const idData = { name: "Alice", age: 30 };
				const result = tp.execute("{{ $root:2 }}", 42, {
					identifierData: { 2: idData },
				});
				expect(result).toEqual(idData);
			});

			test("{{ $root:1 }} returns entire identifierData[1]", () => {
				const idData = { x: 1, y: 2 };
				const result = tp.execute("{{ $root:1 }}", "hello", {
					identifierData: { 1: idData },
				});
				expect(result).toEqual(idData);
			});

			test("{{ $root:0 }} with identifier 0 → returns identifierData[0]", () => {
				const idData = { key: "value" };
				const result = tp.execute("{{ $root:0 }}", null, {
					identifierData: { 0: idData },
				});
				expect(result).toEqual(idData);
			});
		});

		describe("$root:N does NOT affect plain $root", () => {
			test("{{ $root }} still returns data when identifierData is present", () => {
				const result = tp.execute("{{ $root }}", 42, {
					identifierData: { 1: { name: "hello" } },
				});
				expect(result).toBe(42);
			});
		});

		describe("$root:N with missing identifier → undefined", () => {
			test("{{ $root:99 }} with identifierData that lacks 99 → undefined", () => {
				const result = tp.execute("{{ $root:99 }}", 42, {
					identifierData: { 1: { name: "hello" } },
				});
				expect(result).toBeUndefined();
			});

			test("{{ $root:2 }} without identifierData → undefined", () => {
				const result = tp.execute("{{ $root:2 }}", 42);
				expect(result).toBeUndefined();
			});
		});

		describe("$root path traversal with identifier → undefined", () => {
			test("{{ $root.name:2 }} → undefined (path traversal not supported)", () => {
				const result = tp.execute("{{ $root.name:2 }}", userData, {
					identifierData: { 2: userData },
				});
				expect(result).toBeUndefined();
			});
		});

		describe("object template with $root:N", () => {
			test("object template referencing $root:1 → returns entire identifierData[1]", () => {
				const idData = { name: "Alice", age: 30 };
				const result = tp.execute({ everything: "{{ $root:1 }}" }, "ignored", {
					identifierData: { 1: idData },
				});
				expect(result).toEqual({ everything: idData });
			});

			test("object template mixing $root and $root:N", () => {
				const result = tp.execute(
					{
						fromInput: "{{ $root }}",
						fromId: "{{ $root:1 }}",
					},
					42,
					{ identifierData: { 1: { a: 1, b: 2 } } },
				);
				expect((result as Record<string, unknown>).fromInput).toBe(42);
				expect((result as Record<string, unknown>).fromId).toEqual({
					a: 1,
					b: 2,
				});
			});

			test("object template mixing $root:N and regular property", () => {
				const result = tp.execute(
					{
						idRoot: "{{ $root:1 }}",
						direct: "{{ name }}",
					},
					userData,
					{ identifierData: { 1: { x: 99 } } },
				);
				expect((result as Record<string, unknown>).idRoot).toEqual({ x: 99 });
				expect((result as Record<string, unknown>).direct).toBe(userData.name);
			});
		});

		describe("mixed template with $root:N (string concatenation)", () => {
			test("text + $root:N with primitive identifierData value", () => {
				// When $root:N returns an object in a mixed template,
				// Handlebars stringifies it. For a string test, use a single key.
				const result = tp.execute(
					"count={{ count:1 }}",
					{},
					{
						identifierData: { 1: { count: 42 } },
					},
				);
				expect(result).toBe("count=42");
			});
		});
	});

	describe("analyzeAndExecute with $root:N", () => {
		test("$root:1 with primitive identifier schema → valid analysis + correct execution", () => {
			const schema: JSONSchema7 = { type: "number" };
			const idSchema: JSONSchema7 = { type: "string" };
			const { analysis, value } = tp.analyzeAndExecute(
				{ idValue: "{{ $root:1 }}" },
				schema,
				42,
				{
					identifierSchemas: { 1: idSchema },
					identifierData: { 1: { greeting: "hi" } },
				},
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "object",
				properties: {
					idValue: { type: "string" },
				},
				required: ["idValue"],
			});
			expect((value as Record<string, unknown>).idValue).toEqual({
				greeting: "hi",
			});
		});

		test("$root and $root:N in same template → valid analysis + correct execution", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				{
					input: "{{ $root }}",
					id1: "{{ $root:1 }}",
				},
				{ type: "number" },
				99,
				{
					identifierSchemas: { 1: { type: "boolean" } },
					identifierData: { 1: { flag: true } },
				},
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "object",
				properties: {
					input: { type: "number" },
					id1: { type: "boolean" },
				},
				required: ["input", "id1"],
			});
			expect((value as Record<string, unknown>).input).toBe(99);
			expect((value as Record<string, unknown>).id1).toEqual({ flag: true });
		});
	});

	describe("validate with $root:N", () => {
		test("{{ $root:1 }} with valid identifierSchemas → valid", () => {
			const result = tp.validate(
				"{{ $root:1 }}",
				{ type: "number" },
				{
					identifierSchemas: { 1: { type: "string" } },
				},
			);
			expect(result.valid).toBe(true);
		});

		test("{{ $root:99 }} with missing identifier → invalid", () => {
			const result = tp.validate(
				"{{ $root:99 }}",
				{ type: "number" },
				{
					identifierSchemas: { 1: { type: "string" } },
				},
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.code).toBe("UNKNOWN_IDENTIFIER");
		});
	});

	describe("CompiledTemplate with $root:N", () => {
		test("compiled template with {{ $root:1 }} → returns entire identifierData[1]", () => {
			const compiled = tp.compile("{{ $root:1 }}");
			const idData = { name: "Alice" };
			const result = compiled.execute(42, {
				identifierData: { 1: idData },
			});
			expect(result).toEqual(idData);
		});

		test("compiled template with $root:N in object → returns entire identifierData for that key", () => {
			const compiled = tp.compile({ idVal: "{{ $root:2 }}" });
			const idData = { x: 1 };
			const result = compiled.execute("ignored", {
				identifierData: { 2: idData },
			});
			expect((result as Record<string, unknown>).idVal).toEqual(idData);
		});

		test("compiled analyzeAndExecute with $root:N → valid + returns value", () => {
			const compiled = tp.compile("{{ $root:1 }}");
			const { analysis, value } = compiled.analyzeAndExecute(
				{ type: "number" },
				42,
				{
					identifierSchemas: { 1: { type: "string" } },
					identifierData: { 1: { greeting: "hello" } },
				},
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "string" });
			expect(value).toEqual({ greeting: "hello" });
		});
	});
});
