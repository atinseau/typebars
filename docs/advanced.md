# Advanced Features

> **[← Back to README](../README.md)** | **Related:** [Static Analysis](static-analysis.md) · [Execution](execution.md) · [Templates](templates.md) · [API Reference](api-reference.md)

This page covers advanced options that give you fine-grained control over output type inference, expression filtering, and root context access.

---

## Table of Contents

- [Output Type Coercion (`coerceSchema`)](#output-type-coercion-coerceschema)
  - [Why `coerceSchema`?](#why-coerceschema)
  - [Basic Usage](#basic-usage)
  - [Object Templates with `coerceSchema`](#object-templates-with-coerceschema)
  - [Array Templates with `coerceSchema`](#array-templates-with-coerceschema)
  - [Rules](#rules)
  - [With `analyzeAndExecute`](#with-analyzeandexecute)
- [Exclude Template Expressions](#exclude-template-expressions)
  - [Why `excludeTemplateExpression`?](#why-excludetemplateexpression)
  - [Object Templates](#object-templates)
  - [Array Templates](#array-templates)
  - [Root-Level Strings](#root-level-strings)
  - [Combined with `coerceSchema`](#combined-with-coerceschema)
- [`$root` Token](#root-token)
  - [Primitive Schemas](#primitive-schemas)
  - [Object Schemas](#object-schemas)
  - [Path Traversal is Forbidden](#path-traversal-is-forbidden)
  - [`$root` Inside Block Helpers](#root-inside-block-helpers)
  - [`$root` with Identifiers](#root-with-identifiers)

---

## Output Type Coercion (`coerceSchema`)

### Why `coerceSchema`?

By default, static literal values in templates are auto-detected by `detectLiteralType`:
- `"123"` → `number`
- `"true"` → `boolean`
- `"null"` → `null`
- `"hello"` → `string`

The `inputSchema` **never** influences this detection — it only describes available variables for [input validation](static-analysis.md#input-validation).

When building [object templates](templates.md#object-templates), you may want to force the output type of a static value to match a specific schema — for example, keeping `"123"` as a `string` instead of auto-detecting it as `number`. The `coerceSchema` is a **separate source of truth** from `inputSchema`, which avoids false positives in validation.

### Basic Usage

Pass `coerceSchema` in the options to `analyze()`, `analyzeAndExecute()`, or on a [compiled template](execution.md#compiled-templates):

```ts
const engine = new Typebars();

// Without coerceSchema — "123" is auto-detected as number
engine.analyze("123", { type: "string" });
// → outputSchema: { type: "number" }

// With coerceSchema — "123" respects the coercion schema
engine.analyze("123", { type: "string" }, {
  coerceSchema: { type: "string" },
});
// → outputSchema: { type: "string" }
```

`coerceSchema` also affects **execution** — a string that would normally be coerced to a number stays as a string:

```ts
engine.execute("123", {});
// → 123 (number — auto-detected)

engine.execute("123", {}, { coerceSchema: { type: "string" } });
// → "123" (string — coerced)
```

### Object Templates with `coerceSchema`

For object templates, `coerceSchema` is resolved **per-property** and propagated recursively through nested objects. The `coerceSchema` must be an object schema with `properties` matching the template keys:

```ts
const inputSchema = {
  type: "object",
  properties: {
    userName: { type: "string" },
  },
};

const coerceSchema = {
  type: "object",
  properties: {
    meetingId: { type: "string" },
    config: {
      type: "object",
      properties: {
        retries: { type: "string" },
      },
    },
  },
};

const result = engine.analyze(
  {
    meetingId: "12345",        // coerceSchema says string → stays string
    count: "42",               // not in coerceSchema → detectLiteralType → number
    label: "{{userName}}",     // Handlebars expression → resolved from inputSchema
    config: {
      retries: "3",            // coerceSchema says string → stays string
    },
  },
  inputSchema,
  { coerceSchema },
);

result.outputSchema;
// → {
//   type: "object",
//   properties: {
//     meetingId: { type: "string" },  ← coerced
//     count:     { type: "number" },  ← auto-detected
//     label:     { type: "string" },  ← from inputSchema
//     config: {
//       type: "object",
//       properties: {
//         retries: { type: "string" },  ← coerced (deep propagation)
//       },
//       required: ["retries"],
//     },
//   },
//   required: ["meetingId", "count", "label", "config"],
// }
```

### Array Templates with `coerceSchema`

For [array templates](templates.md#array-templates), `coerceSchema` with an `items` property is propagated to each element:

```ts
const coerceSchema = {
  type: "array",
  items: { type: "string" },
};

engine.analyze(
  ["123", "456", "hello"],
  {},
  { coerceSchema },
).outputSchema;
// → items coerced as strings instead of auto-detecting "123" and "456" as numbers
```

### Rules

| Scenario | Output type |
|----------|-------------|
| Static literal, no `coerceSchema` | `detectLiteralType` (e.g. `"123"` → `number`) |
| Static literal, `coerceSchema` with primitive type | Respects `coerceSchema` type |
| Static literal, `coerceSchema` with non-primitive type (object, array) | Falls back to `detectLiteralType` |
| Static literal, `coerceSchema` with no `type` | Falls back to `detectLiteralType` |
| Handlebars expression (`{{expr}}`) | Always resolved from `inputSchema` — `coerceSchema` ignored |
| Mixed template (`text + {{expr}}`) | Always `string` — `coerceSchema` ignored |
| JS primitive literal (`42`, `true`, `null`) | Always `inferPrimitiveSchema` — `coerceSchema` ignored |
| Property not in `coerceSchema` | Falls back to `detectLiteralType` |

> **Key principle:** `coerceSchema` only affects **static string literals** (strings without `{{…}}`). Handlebars expressions, mixed templates, and JS primitive literals are never affected.

### With `analyzeAndExecute`

`coerceSchema` works with `analyzeAndExecute` — it affects both the analysis output schema and the execution coercion:

```ts
const { analysis, value } = engine.analyzeAndExecute(
  { meetingId: "12345", name: "{{userName}}" },
  inputSchema,
  { userName: "Alice" },
  {
    coerceSchema: {
      type: "object",
      properties: { meetingId: { type: "string" } },
    },
  },
);

analysis.outputSchema;
// → { type: "object", properties: { meetingId: { type: "string" }, name: { type: "string" } }, ... }
value;
// → { meetingId: "12345", name: "Alice" }
// (meetingId stays as string "12345" instead of being coerced to number 12345)
```

---

## Exclude Template Expressions

### Why `excludeTemplateExpression`?

The `excludeTemplateExpression` option filters out properties (or array elements) whose values contain Handlebars expressions (`{{…}}`). Only static values — literals, plain strings without expressions — are retained in the output.

This is useful when you want the output schema to describe only the **known, compile-time-constant** portion of the template, or when you want to separate static configuration from dynamic content.

### Object Templates

When `excludeTemplateExpression: true` is set, object properties containing Handlebars expressions are **removed** from the output schema and from the executed result:

```ts
const engine = new Typebars();

const inputSchema = {
  type: "object",
  properties: { name: { type: "string" } },
};

// Analysis — dynamic properties are excluded from the output schema
const result = engine.analyze(
  {
    greeting: "Hello {{name}}!",   // contains expression → excluded
    version: "42",                  // plain string → kept
    active: true,                   // literal → kept
  },
  inputSchema,
  { excludeTemplateExpression: true },
);

result.outputSchema;
// → {
//   type: "object",
//   properties: {
//     version: { type: "number" },   ← kept (static literal, auto-detected)
//     active:  { type: "boolean" },  ← kept (literal passthrough)
//   },
//   required: ["version", "active"],
// }
// "greeting" is excluded because it contains {{name}}

// Execution — dynamic properties are excluded from the result
engine.execute(
  {
    greeting: "Hello {{name}}!",
    version: "42",
    active: true,
  },
  { name: "Alice" },
  { excludeTemplateExpression: true },
);
// → { version: 42, active: true }
// "greeting" is excluded from the output
```

The filtering is recursive — nested objects are also filtered:

```ts
engine.execute(
  {
    config: {
      label: "{{name}}",     // excluded
      retries: "3",           // kept
    },
    status: "active",         // kept
  },
  { name: "Alice" },
  { excludeTemplateExpression: true },
);
// → { config: { retries: 3 }, status: "active" }
```

### Array Templates

For [array templates](templates.md#array-templates), elements containing expressions are filtered out:

```ts
engine.execute(
  ["Hello {{name}}!", "static value", 42, "{{age}}"],
  { name: "Alice", age: 30 },
  { excludeTemplateExpression: true },
);
// → ["static value", 42]
// "Hello {{name}}!" and "{{age}}" are excluded
```

### Root-Level Strings

When `excludeTemplateExpression` is used on a **root-level string** (not inside an object or array), there is no parent to remove the entry from. In this case:

- **Analysis**: the template is analyzed normally (no filtering possible at root)
- **Execution**: returns `null` if the string contains expressions

```ts
engine.execute("Hello {{name}}!", { name: "Alice" }, {
  excludeTemplateExpression: true,
});
// → null (root-level string with expression)

engine.execute("static text", {}, {
  excludeTemplateExpression: true,
});
// → "static text" (no expression → kept)
```

### Combined with `coerceSchema`

`excludeTemplateExpression` and `coerceSchema` can be used together. The filtering happens first, then coercion applies to the remaining static values:

```ts
engine.analyze(
  {
    meetingId: "12345",
    greeting: "Hello {{name}}!",
  },
  inputSchema,
  {
    excludeTemplateExpression: true,
    coerceSchema: {
      type: "object",
      properties: { meetingId: { type: "string" } },
    },
  },
).outputSchema;
// → {
//   type: "object",
//   properties: {
//     meetingId: { type: "string" },  ← kept + coerced
//   },
//   required: ["meetingId"],
// }
// "greeting" excluded, "meetingId" coerced to string
```

---

## `$root` Token

The `$root` token allows referencing the **entire input schema / data context** directly. This is primarily useful when the `inputSchema` is a **primitive type** (e.g. `{ type: "string" }`) rather than an object with properties.

### Primitive Schemas

When the input schema is a primitive type, there are no named properties to reference. Use `{{ $root }}` to access the entire value:

```ts
const engine = new Typebars();

// String schema
engine.analyze("{{ $root }}", { type: "string" });
// → valid: true, outputSchema: { type: "string" }

engine.execute("{{ $root }}", "hello");
// → "hello"

// Number schema
engine.analyze("{{ $root }}", { type: "number" });
// → valid: true, outputSchema: { type: "number" }

engine.execute("{{ $root }}", 42);
// → 42

// Boolean schema
engine.analyze("{{ $root }}", { type: "boolean" });
// → valid: true, outputSchema: { type: "boolean" }

engine.execute("{{ $root }}", true);
// → true
```

### Object Schemas

`$root` also works with object schemas — it resolves to the **entire object**:

```ts
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age:  { type: "number" },
  },
};

engine.analyze("{{ $root }}", schema);
// → valid: true, outputSchema: the full object schema

engine.execute("{{ $root }}", { name: "Alice", age: 30 });
// → { name: "Alice", age: 30 }
```

### Path Traversal is Forbidden

Using `$root` with dot notation (e.g. `{{ $root.name }}`) is **forbidden** and produces a `ROOT_PATH_TRAVERSAL` diagnostic error. This is because properties are already directly accessible in the context — use `{{ name }}` instead of `{{ $root.name }}`.

```ts
// ❌ Path traversal on $root → error
engine.analyze("{{ $root.name }}", schema);
// → valid: false, code: ROOT_PATH_TRAVERSAL

engine.analyze("{{ $root.address.city }}", schema);
// → valid: false, code: ROOT_PATH_TRAVERSAL

// ✅ Use the property directly instead
engine.analyze("{{ name }}", schema);
// → valid: true
```

The `ROOT_PATH_TRAVERSAL` check happens **before** property resolution — even if the property exists, the path traversal is rejected:

```ts
engine.analyze("{{ $root.nonexistent }}", schema);
// → code: ROOT_PATH_TRAVERSAL (NOT UNKNOWN_PROPERTY)
```

This applies everywhere — root-level templates, [object templates](templates.md#object-templates), mixed templates, and inside [block helpers](templates.md#block-helpers):

```ts
// Object template
engine.analyze({ displayName: "{{ $root.name }}" }, schema);
// → ROOT_PATH_TRAVERSAL

// Mixed template
engine.analyze("Hello {{ $root.name }}!", schema);
// → ROOT_PATH_TRAVERSAL
```

### `$root` Inside Block Helpers

`$root` (without path traversal) can be used as a block helper condition:

```ts
// ✅ $root as #if condition — checks truthiness of the entire root value
engine.analyze("{{#if $root}}yes{{/if}}", { type: "boolean" });
// → valid: true

// ❌ $root.active as #if condition → ROOT_PATH_TRAVERSAL
engine.analyze("{{#if $root.active}}active{{else}}inactive{{/if}}", schema);
// → valid: false, code: ROOT_PATH_TRAVERSAL
```

### `$root` with Identifiers

`$root` can be combined with [template identifiers](identifiers.md). The `$root` resolves against the identifier's schema:

```ts
const identifierSchemas = {
  1: { type: "string" },
};

// ✅ $root:1 → resolves to the entire identifier 1 schema
engine.analyze("{{ $root:1 }}", {}, { identifierSchemas });
// → valid: true, outputSchema: { type: "string" }

// ❌ $root.name:2 → ROOT_PATH_TRAVERSAL (path traversal still forbidden)
engine.analyze("{{ $root.name:2 }}", {}, {
  identifierSchemas: { 2: schema },
});
// → valid: false, code: ROOT_PATH_TRAVERSAL
```

---

## What's Next?

- **[Error Handling](error-handling.md)** — error hierarchy, diagnostics, and the `ROOT_PATH_TRAVERSAL` code
- **[Static Analysis](static-analysis.md)** — full diagnostics reference and output schema inference
- **[Templates](templates.md)** — object templates, array templates, and block helpers
- **[API Reference](api-reference.md)** — full options signatures for `AnalyzeOptions`, `ExecuteOptions`, etc.