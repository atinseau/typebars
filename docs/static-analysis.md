# Static Analysis

> **[← Back to README](../README.md)** | **Related:** [Schema Features](schema-features.md) · [Error Handling](error-handling.md) · [API Reference](api-reference.md)

Typebars statically analyzes templates **before execution**. Given a template and a JSON Schema describing the available data, it:

1. **Validates** every `{{expression}}` against the input schema
2. **Reports** structured diagnostics (errors and warnings)
3. **Infers** the JSON Schema of the output value

No data is needed — the analysis is purely static.

---

## Table of Contents

- [Input Validation](#input-validation)
  - [Property Validation](#property-validation)
  - [Nested Properties (Dot Notation)](#nested-properties-dot-notation)
  - [Validation Inside Block Helpers](#validation-inside-block-helpers)
- [Diagnostics](#diagnostics)
  - [Diagnostic Structure](#diagnostic-structure)
  - [Diagnostic Codes](#diagnostic-codes)
- [Output Schema Inference](#output-schema-inference)
  - [Single Expression → Resolved Type](#single-expression--resolved-type)
  - [Mixed Template → String](#mixed-template--string)
  - [Single Block → Branch Type Inference](#single-block--branch-type-inference)
  - [Object Templates → Object Schema](#object-templates--object-schema)
  - [Literal Inputs → Primitive Schema](#literal-inputs--primitive-schema)

---

## Input Validation

### Property Validation

Every `{{expression}}` in the template is validated against the input schema. If a property doesn't exist, Typebars reports an error with the available properties:

```ts
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age:  { type: "number" },
  },
};

// ✅ Valid — "name" exists in the schema
engine.analyze("{{name}}", schema);
// → { valid: true, diagnostics: [] }

// ❌ Invalid — "firstName" does not exist
engine.analyze("{{firstName}}", schema);
// → {
//   valid: false,
//   diagnostics: [{
//     severity: "error",
//     code: "UNKNOWN_PROPERTY",
//     message: 'Property "firstName" does not exist in the context schema. Available properties: age, name',
//     details: { path: "firstName", availableProperties: ["age", "name"] }
//   }]
// }

// Multiple errors are reported at once
engine.analyze("{{foo}} and {{bar}}", schema);
// → 2 diagnostics, one for "foo" and one for "bar"
```

### Nested Properties (Dot Notation)

Dot notation is validated at every depth level:

```ts
const schema = {
  type: "object",
  properties: {
    address: {
      type: "object",
      properties: {
        city: { type: "string" },
        zip:  { type: "string" },
      },
    },
    metadata: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["admin", "user", "guest"] },
      },
    },
  },
};

// ✅ Valid — full path resolved
engine.analyze("{{address.city}}", schema);   // valid: true
engine.analyze("{{metadata.role}}", schema);  // valid: true

// ❌ Invalid — "country" doesn't exist inside "address"
engine.analyze("{{address.country}}", schema);
// → error: Property "address.country" does not exist
```

### Validation Inside Block Helpers

The analyzer walks **into** block helpers and validates every expression in every branch. See [Block Helpers](templates.md#block-helpers) for the full list of supported blocks.

```ts
const schema = {
  type: "object",
  properties: {
    active: { type: "boolean" },
    name:   { type: "string" },
    tags:   { type: "array", items: { type: "string" } },
    orders: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:      { type: "number" },
          product: { type: "string" },
        },
      },
    },
    address: {
      type: "object",
      properties: {
        city: { type: "string" },
      },
    },
  },
};

// ✅ #if — validates the condition AND both branches
engine.analyze("{{#if active}}{{name}}{{else}}unknown{{/if}}", schema);
// valid: true

// ❌ #if — invalid properties inside branches are caught
engine.analyze("{{#if active}}{{badProp1}}{{else}}{{badProp2}}{{/if}}", schema);
// valid: false — 2 errors (one per branch)

// ❌ #if — invalid condition is caught
engine.analyze("{{#if nonexistent}}yes{{/if}}", schema);
// valid: false — "nonexistent" doesn't exist

// ✅ #each — validates that the target is an array, then validates
//    the body against the item schema
engine.analyze("{{#each orders}}{{product}} #{{id}}{{/each}}", schema);
// valid: true — "product" and "id" exist in the item schema

// ❌ #each — property doesn't exist in the item schema
engine.analyze("{{#each orders}}{{badField}}{{/each}}", schema);
// valid: false — "badField" doesn't exist in order items

// ❌ #each — target is not an array
engine.analyze("{{#each name}}{{this}}{{/each}}", schema);
// valid: false — TYPE_MISMATCH: "{{#each}}" expects array, got "string"

// ✅ #with — changes context to a sub-object, validates inner expressions
engine.analyze("{{#with address}}{{city}}{{/with}}", schema);
// valid: true

// ❌ #with — property doesn't exist in the sub-context
engine.analyze("{{#with address}}{{country}}{{/with}}", schema);
// valid: false — "country" doesn't exist inside "address"

// ✅ Nested blocks — validated at every level
engine.analyze(
  "{{#with address}}{{city}}{{/with}} — {{#each tags}}{{this}}{{/each}}",
  schema,
);
// valid: true
```

**Key insight:** `{{#each}}` changes the schema context to the array's `items` schema. Inside `{{#each orders}}`, the context becomes `{ type: "object", properties: { id, product } }`. Inside `{{#each tags}}`, the context becomes `{ type: "string" }` and `{{this}}` refers to each string element.

`{{#with}}` changes the schema context to the resolved sub-object schema. Inside `{{#with address}}`, the context becomes the schema of `address`.

Sub-expression conditions like `{{#if (gt age 18)}}` are also fully validated — see [Built-in Helpers — Static Analysis of Sub-Expressions](helpers.md#static-analysis-of-sub-expressions).

---

## Diagnostics

### Diagnostic Structure

Every diagnostic is a structured object with machine-readable fields:

```ts
interface TemplateDiagnostic {
  severity: "error" | "warning";
  code: DiagnosticCode;
  message: string;
  loc?: {
    start: { line: number; column: number };
    end:   { line: number; column: number };
  };
  source?: string;
  details?: {
    path?: string;
    helperName?: string;
    expected?: string;
    actual?: string;
    availableProperties?: string[];
    identifier?: number;
  };
}
```

See [Error Handling](error-handling.md) for how diagnostics are surfaced via error classes (`TemplateAnalysisError`).

### Diagnostic Codes

| Code | Severity | Description |
|------|----------|-------------|
| `UNKNOWN_PROPERTY` | error | Property doesn't exist in the schema |
| `TYPE_MISMATCH` | error | Incompatible type (e.g. `{{#each}}` on a non-array) |
| `MISSING_ARGUMENT` | error | Block helper used without required argument |
| `UNKNOWN_HELPER` | warning | Unknown block helper |
| `UNANALYZABLE` | warning | Expression can't be statically analyzed |
| `MISSING_IDENTIFIER_SCHEMAS` | error | `{{key:N}}` used but no identifier schemas provided — see [Identifiers](identifiers.md) |
| `UNKNOWN_IDENTIFIER` | error | Identifier N not found in identifier schemas — see [Identifiers](identifiers.md) |
| `IDENTIFIER_PROPERTY_NOT_FOUND` | error | Property doesn't exist in identifier's schema — see [Identifiers](identifiers.md) |
| `PARSE_ERROR` | error | Invalid Handlebars syntax |
| `ROOT_PATH_TRAVERSAL` | error | `$root` used with path traversal (e.g. `$root.name`) — see [`$root` token](advanced.md#root-token) |
| `DEFAULT_NO_GUARANTEED_VALUE` | error | `default` helper chain has no guaranteed fallback — see [Default Helper](helpers.md#static-analysis-of-default) |

---

## Output Schema Inference

This is where Typebars shines. Given a template and an input schema, Typebars **infers the JSON Schema of the output value**. The inferred type depends on the template structure.

### Single Expression → Resolved Type

When the template is a single `{{expression}}` (with optional whitespace around it), the output schema is the resolved type from the input schema:

```ts
const schema = {
  type: "object",
  properties: {
    name:    { type: "string" },
    age:     { type: "number" },
    score:   { type: "integer" },
    active:  { type: "boolean" },
    address: {
      type: "object",
      properties: {
        city: { type: "string" },
        zip:  { type: "string" },
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    role: { type: "string", enum: ["admin", "user", "guest"] },
  },
};

engine.analyze("{{name}}", schema).outputSchema;
// → { type: "string" }

engine.analyze("{{age}}", schema).outputSchema;
// → { type: "number" }

engine.analyze("{{score}}", schema).outputSchema;
// → { type: "integer" }

engine.analyze("{{active}}", schema).outputSchema;
// → { type: "boolean" }

engine.analyze("{{address}}", schema).outputSchema;
// → { type: "object", properties: { city: { type: "string" }, zip: { type: "string" } } }

engine.analyze("{{tags}}", schema).outputSchema;
// → { type: "array", items: { type: "string" } }

// Dot notation resolves to the leaf type
engine.analyze("{{address.city}}", schema).outputSchema;
// → { type: "string" }

// Enums are preserved
engine.analyze("{{role}}", schema).outputSchema;
// → { type: "string", enum: ["admin", "user", "guest"] }

// Whitespace around a single expression is ignored
engine.analyze("  {{age}}  ", schema).outputSchema;
// → { type: "number" }
```

**This is the key mechanism**: the output schema is **derived from** the input schema by resolving the expression path. `{{age}}` in a schema where `age` is `{ type: "number" }` produces an output schema of `{ type: "number" }`.

### Mixed Template → String

When a template contains text **and** expressions, or multiple expressions, the output is always `{ type: "string" }` — because Handlebars concatenates everything into a string:

```ts
engine.analyze("Hello {{name}}", schema).outputSchema;
// → { type: "string" }

engine.analyze("{{name}} ({{age}})", schema).outputSchema;
// → { type: "string" }

engine.analyze("Just plain text", schema).outputSchema;
// → { type: "string" }
```

### Single Block → Branch Type Inference

When the template is a **single block** (optionally surrounded by whitespace), Typebars infers the type from the block's branches:

```ts
// Both branches are numeric literals → output is number
engine.analyze("{{#if active}}10{{else}}20{{/if}}", schema).outputSchema;
// → { type: "number" }

// Both branches are booleans → output is boolean
engine.analyze("{{#if active}}true{{else}}false{{/if}}", schema).outputSchema;
// → { type: "boolean" }

// Both branches are single expressions of the same type → that type
engine.analyze(
  "{{#if active}}{{name}}{{else}}{{address.city}}{{/if}}",
  schema,
).outputSchema;
// → { type: "string" }

// Branches with different types → oneOf union
engine.analyze(
  "{{#if active}}{{age}}{{else}}{{score}}{{/if}}",
  schema,
).outputSchema;
// → { oneOf: [{ type: "number" }, { type: "integer" }] }

engine.analyze(
  "{{#if active}}42{{else}}hello{{/if}}",
  schema,
).outputSchema;
// → { oneOf: [{ type: "number" }, { type: "string" }] }

// null in one branch → union with null
engine.analyze(
  "{{#if active}}null{{else}}fallback{{/if}}",
  schema,
).outputSchema;
// → { oneOf: [{ type: "null" }, { type: "string" }] }

// #unless works the same way
engine.analyze(
  "{{#unless active}}0{{else}}1{{/unless}}",
  schema,
).outputSchema;
// → { type: "number" }

// #with as single block → type of the inner body
engine.analyze("{{#with address}}{{city}}{{/with}}", schema).outputSchema;
// → { type: "string" }

// #each always produces string (concatenation of iterations)
engine.analyze("{{#each tags}}{{this}}{{/each}}", schema).outputSchema;
// → { type: "string" }
```

**Inference logic per block type:**

| Block | Output Schema |
|-------|---------------|
| `{{#if}}` with else | `oneOf(then_type, else_type)` (simplified if both are equal) |
| `{{#if}}` without else | Type of the then branch |
| `{{#unless}}` | Same as `{{#if}}` (inverted semantics, same type inference) |
| `{{#each}}` | Always `{ type: "string" }` (concatenation) |
| `{{#with}}` | Type of the inner body |

### Object Templates → Object Schema

When you pass an object as a template, each property is analyzed independently and the output schema is an object schema. See [Object Templates](templates.md#object-templates) for execution examples.

```ts
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age:  { type: "number" },
    city: { type: "string" },
  },
};

const analysis = engine.analyze(
  {
    userName: "Hello {{name}}!",  // mixed → string
    userAge:  "{{age}}",          // single expression → number
    location: "{{city}}",         // single expression → string
  },
  schema,
);

analysis.outputSchema;
// → {
//   type: "object",
//   properties: {
//     userName: { type: "string" },
//     userAge:  { type: "number" },
//     location: { type: "string" },
//   },
//   required: ["userName", "userAge", "location"],
// }
```

Nesting works recursively:

```ts
engine.analyze(
  {
    user: {
      name: "{{name}}",
      age:  "{{age}}",
    },
    meta: {
      active: "{{active}}",
    },
  },
  schema,
).outputSchema;
// → {
//   type: "object",
//   properties: {
//     user: {
//       type: "object",
//       properties: {
//         name: { type: "string" },
//         age:  { type: "number" },
//       },
//       required: ["name", "age"],
//     },
//     meta: {
//       type: "object",
//       properties: {
//         active: { type: "boolean" },
//       },
//       required: ["active"],
//     },
//   },
//   required: ["user", "meta"],
// }
```

If **any** property in the object template is invalid, the entire object is marked as `valid: false` and all diagnostics are collected.

### Literal Inputs → Primitive Schema

Non-string values (`number`, `boolean`, `null`) are treated as passthrough literals. They are always valid (the input schema is ignored) and their output schema is inferred from the value:

```ts
engine.analyze(42, schema).outputSchema;
// → { type: "integer" }

engine.analyze(3.14, schema).outputSchema;
// → { type: "number" }

engine.analyze(true, schema).outputSchema;
// → { type: "boolean" }

engine.analyze(null, schema).outputSchema;
// → { type: "null" }
```

This is useful in [object templates](templates.md#object-templates) where some properties are fixed values:

```ts
engine.analyze(
  {
    name:     "{{name}}",  // → string (from schema)
    version:  42,          // → integer (literal)
    isPublic: true,        // → boolean (literal)
    deleted:  null,        // → null (literal)
  },
  schema,
).outputSchema;
// → {
//   type: "object",
//   properties: {
//     name:     { type: "string" },
//     version:  { type: "integer" },
//     isPublic: { type: "boolean" },
//     deleted:  { type: "null" },
//   },
//   required: ["name", "version", "isPublic", "deleted"],
// }
```

---

## What's Next?

- **[Schema Features](schema-features.md)** — `$ref` resolution, combinators, `additionalProperties`
- **[Templates](templates.md)** — object templates, array templates, and block helpers
- **[Error Handling](error-handling.md)** — error classes and how diagnostics are surfaced
- **[Advanced Features](advanced.md)** — `coerceSchema`, `excludeTemplateExpression`, `$root` token