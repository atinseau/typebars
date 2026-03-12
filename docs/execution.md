# Execution & Compiled Templates

> **[← Back to README](../README.md)** | **Related:** [Static Analysis](static-analysis.md) · [Templates](templates.md) · [API Reference](api-reference.md)

Typebars preserves types at execution time. Unlike standard Handlebars (which always returns strings), Typebars returns the **raw value** when possible — numbers stay numbers, booleans stay booleans, arrays stay arrays.

---

## Table of Contents

- [Type Preservation](#type-preservation)
- [Execution Modes](#execution-modes)
  - [Single Expression](#single-expression)
  - [Fast-Path](#fast-path)
  - [Single Block](#single-block)
  - [Mixed Template](#mixed-template)
- [Literal Passthrough](#literal-passthrough)
- [Compiled Templates](#compiled-templates)
  - [Basic Usage](#basic-usage)
  - [Object and Literal Compilation](#object-and-literal-compilation)
  - [Analysis on Compiled Templates](#analysis-on-compiled-templates)

---

## Type Preservation

The return type of `execute()` depends on the template structure:

| Template Shape | Execution Return Type |
|---|---|
| Single expression `{{expr}}` | Raw value (`number`, `boolean`, `object`, `array`, `null`…) |
| Mixed template `text {{expr}}` | `string` (concatenation) |
| Single block with literal branches | Coerced value (`number`, `boolean`, `null`) |
| Multi-block or mixed | `string` |
| Literal input (`42`, `true`, `null`) | The value as-is |

```ts
const engine = new Typebars();
const data = { name: "Alice", age: 30, active: true, tags: ["ts", "js"] };

// Single expression → raw type
engine.execute("{{age}}", data);     // → 30 (number)
engine.execute("{{active}}", data);  // → true (boolean)
engine.execute("{{tags}}", data);    // → ["ts", "js"] (array)

// Mixed → string
engine.execute("Age: {{age}}", data); // → "Age: 30" (string)

// Single block with literal branches → coerced
engine.execute("{{#if active}}42{{else}}0{{/if}}", data);       // → 42 (number)
engine.execute("{{#if active}}true{{else}}false{{/if}}", data); // → true (boolean)

// Literal passthrough
engine.execute(42, data);   // → 42
engine.execute(true, data); // → true
engine.execute(null, data); // → null
```

This means the **output schema** inferred at [analysis time](static-analysis.md#output-schema-inference) matches the actual runtime value type.

---

## Execution Modes

Internally, Typebars uses four execution modes, ordered from fastest to most general. The engine automatically selects the best mode based on the template structure.

### Single Expression

When the template is a single `{{expression}}` (with optional surrounding whitespace), the executor **bypasses Handlebars entirely** and resolves the value directly from the data object. This is the fastest path and preserves the raw type.

```ts
engine.execute("{{age}}", { age: 30 });       // → 30 (number — no Handlebars involved)
engine.execute("  {{tags}}  ", { tags: [1] }); // → [1] (array — whitespace is trimmed)
```

This also applies to helpers that return non-primitive values:

```ts
engine.execute('{{map users "name"}}', { users: [{ name: "Alice" }, { name: "Bob" }] });
// → ["Alice", "Bob"] (array — bypasses Handlebars, direct execution)
```

### Fast-Path

A fast-path optimization is used for simple templates that can be resolved without full Handlebars compilation. The parser detects these patterns and the executor handles them with string concatenation.

### Single Block

When the template is a single block helper (`{{#if}}`, `{{#unless}}`, `{{#with}}`), the executor evaluates the block and attempts to **coerce the result** back to a typed value:

```ts
engine.execute("{{#if active}}42{{else}}0{{/if}}", { active: true });
// → 42 (number — the string "42" is coerced back to a number)

engine.execute("{{#if active}}null{{else}}fallback{{/if}}", { active: true });
// → null (the string "null" is coerced to null)
```

### Mixed Template

For templates with text + expressions, multiple blocks, or any complex structure, the executor falls back to standard Handlebars compilation. The result is always a `string`:

```ts
engine.execute("Hello {{name}}, you are {{age}}", data);
// → "Hello Alice, you are 30" (string)
```

---

## Literal Passthrough

Non-string inputs (`number`, `boolean`, `null`) bypass the template engine entirely and are returned as-is:

```ts
engine.execute(42, {});   // → 42
engine.execute(true, {}); // → true
engine.execute(null, {}); // → null
```

This is particularly useful in [object templates](templates.md#object-templates) where some properties are fixed values alongside dynamic templates.

---

## Compiled Templates

For templates executed multiple times with different data, `compile()` parses the template **once** and returns a reusable `CompiledTemplate`. This avoids re-parsing and re-compiling on every call.

### Basic Usage

```ts
const engine = new Typebars();
const tpl = engine.compile("Hello {{name}}!");

// No re-parsing — execute many times with different data
tpl.execute({ name: "Alice" }); // → "Hello Alice!"
tpl.execute({ name: "Bob" });   // → "Hello Bob!"
```

### Object and Literal Compilation

Object templates and literal values can also be compiled:

```ts
const tpl = engine.compile({
  userName: "{{name}}",
  userAge:  "{{age}}",
  fixed:    42,
});

tpl.execute(data);
// → { userName: "Alice", userAge: 30, fixed: 42 }
```

The compiled template uses a discriminated union internally (`TemplateState`) with kinds: `"template"`, `"literal"`, `"object"`, and `"array"`.

### Analysis on Compiled Templates

`CompiledTemplate` supports the same analysis methods as the engine — without re-parsing:

```ts
const tpl = engine.compile("{{age}}");

// Analyze
tpl.analyze(schema);
// → { valid: true, outputSchema: { type: "number" }, diagnostics: [] }

// Validate (no outputSchema)
tpl.validate(schema);
// → { valid: true, diagnostics: [] }

// Both at once
const { analysis, value } = tpl.analyzeAndExecute(schema, data);
// analysis.outputSchema → { type: "number" }
// value → 30
```

All [advanced options](advanced.md) (`coerceSchema`, `excludeTemplateExpression`, `identifierSchemas`) work with compiled templates as well.

---

## What's Next?

- **[Templates](templates.md)** — object templates, array templates, and block helpers
- **[Built-in & Custom Helpers](helpers.md)** — math, logical, comparison, map, and custom helpers
- **[Advanced Features](advanced.md)** — `coerceSchema`, `excludeTemplateExpression`, `$root` token
- **[API Reference](api-reference.md)** — full method signatures for `execute()`, `compile()`, and `CompiledTemplate`
