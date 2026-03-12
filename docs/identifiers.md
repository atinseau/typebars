# Template Identifiers (`{{key:N}}`)

> **[← Back to README](../README.md)** | **Related:** [Static Analysis](static-analysis.md) · [Execution](execution.md) · [API Reference](api-reference.md)

The `{{key:N}}` syntax references variables from **different data sources**, identified by a numeric ID. This is useful in workflow engines, multi-step pipelines, or any scenario where template variables come from multiple independent contexts.

---

## Table of Contents

- [Overview](#overview)
- [Analysis with Identifier Schemas](#analysis-with-identifier-schemas)
- [Mixing Identifiers and Regular Expressions](#mixing-identifiers-and-regular-expressions)
- [Execution with Identifier Data](#execution-with-identifier-data)
- [`analyzeAndExecute` with Identifiers](#analyzeandexecute-with-identifiers)
- [Identifier Diagnostics](#identifier-diagnostics)

---

## Overview

In standard Handlebars, all variables come from a single data context:

```handlebars
Hello {{name}}, your order is {{orderId}}.
```

With template identifiers, you can reference variables from **separate data sources** by appending `:N` to the variable name, where `N` is a numeric identifier:

```handlebars
Hello {{name}}, your meeting is {{meetingId:1}} with lead {{leadName:2}}.
```

Here:
- `{{name}}` — resolved from the main `inputSchema` / `data`
- `{{meetingId:1}}` — resolved from identifier **1**'s schema / data
- `{{leadName:2}}` — resolved from identifier **2**'s schema / data

The identifier is always on the **last path segment**. For example, `{{address.city:1}}` resolves `address.city` from identifier 1's schema.

---

## Analysis with Identifier Schemas

Each identifier maps to its own JSON Schema. Pass them via the `options` object:

```ts
const engine = new Typebars();

const inputSchema = { type: "object", properties: {} };

const identifierSchemas = {
  1: {
    type: "object",
    properties: { meetingId: { type: "string" } },
  },
  2: {
    type: "object",
    properties: { leadName: { type: "string" } },
  },
};

// ✅ Valid — meetingId exists in identifier 1's schema
engine.analyze("{{meetingId:1}}", inputSchema, { identifierSchemas });
// → valid: true, outputSchema: { type: "string" }

// ❌ Invalid — identifier 1 doesn't have "badKey"
engine.analyze("{{badKey:1}}", inputSchema, { identifierSchemas });
// → valid: false, code: IDENTIFIER_PROPERTY_NOT_FOUND

// ❌ Invalid — identifier 99 doesn't exist
engine.analyze("{{meetingId:99}}", inputSchema, { identifierSchemas });
// → valid: false, code: UNKNOWN_IDENTIFIER

// ❌ Invalid — identifiers used but no schemas provided
engine.analyze("{{meetingId:1}}", inputSchema);
// → valid: false, code: MISSING_IDENTIFIER_SCHEMAS
```

---

## Mixing Identifiers and Regular Expressions

Regular expressions validate against `inputSchema`, identifier expressions validate against `identifierSchemas`. Both can coexist in the same template:

```ts
const schema = {
  type: "object",
  properties: { name: { type: "string" } },
};

const idSchemas = {
  1: {
    type: "object",
    properties: { meetingId: { type: "string" } },
  },
};

// ✅ "name" validated against schema, "meetingId:1" against idSchemas[1]
engine.analyze("{{name}} — {{meetingId:1}}", schema, {
  identifierSchemas: idSchemas,
});
// → valid: true
```

This also works in [object templates](templates.md#object-templates):

```ts
engine.analyze(
  {
    userName:  "{{name}}",
    meeting:   "{{meetingId:1}}",
    summary:   "{{name}} has meeting {{meetingId:1}}",
  },
  schema,
  { identifierSchemas: idSchemas },
);
// → valid: true
```

---

## Execution with Identifier Data

At execution time, pass `identifierData` in the options. Each key maps an identifier number to its data object:

```ts
const result = engine.execute(
  "Meeting: {{meetingId:1}}, Lead: {{leadName:2}}",
  {},
  {
    identifierData: {
      1: { meetingId: "MTG-42" },
      2: { leadName: "Alice" },
    },
  },
);
// → "Meeting: MTG-42, Lead: Alice"
```

[Type preservation](execution.md#type-preservation) works the same way for identifier expressions. A single expression with an identifier returns the raw value:

```ts
engine.execute("{{count:1}}", {}, {
  identifierData: { 1: { count: 42 } },
});
// → 42 (number, not string)
```

---

## `analyzeAndExecute` with Identifiers

Both `identifierSchemas` (for analysis) and `identifierData` (for execution) are passed in the options:

```ts
const { analysis, value } = engine.analyzeAndExecute(
  "{{total:1}}",
  {},    // inputSchema
  {},    // data
  {
    identifierSchemas: {
      1: { type: "object", properties: { total: { type: "number" } } },
    },
    identifierData: {
      1: { total: 99.95 },
    },
  },
);

analysis.valid;        // true
analysis.outputSchema; // { type: "number" }
value;                 // 99.95
```

[Compiled templates](execution.md#compiled-templates) also support identifiers through their `analyze()`, `execute()`, and `analyzeAndExecute()` methods.

---

## Identifier Diagnostics

Three [diagnostic codes](static-analysis.md#diagnostic-codes) are specific to template identifiers:

| Code | Severity | Description |
|------|----------|-------------|
| `MISSING_IDENTIFIER_SCHEMAS` | error | The `{{key:N}}` syntax is used but no `identifierSchemas` were provided in the options |
| `UNKNOWN_IDENTIFIER` | error | The identifier `N` does not exist in the provided `identifierSchemas` |
| `IDENTIFIER_PROPERTY_NOT_FOUND` | error | The property does not exist in the identifier's schema |

```ts
// No identifierSchemas provided at all
engine.analyze("{{meetingId:1}}", inputSchema);
// → code: MISSING_IDENTIFIER_SCHEMAS

// Identifier 99 not found
engine.analyze("{{meetingId:99}}", inputSchema, {
  identifierSchemas: { 1: { type: "object", properties: {} } },
});
// → code: UNKNOWN_IDENTIFIER, details: { identifier: 99 }

// Property doesn't exist in identifier's schema
engine.analyze("{{badKey:1}}", inputSchema, {
  identifierSchemas: {
    1: { type: "object", properties: { meetingId: { type: "string" } } },
  },
});
// → code: IDENTIFIER_PROPERTY_NOT_FOUND, details: { path: "badKey", identifier: 1 }
```

---

## What's Next?

- **[Advanced Features](advanced.md)** — `coerceSchema`, `excludeTemplateExpression`, `$root` token
- **[Static Analysis](static-analysis.md)** — full diagnostics reference and output schema inference
- **[Execution](execution.md)** — type preservation and compiled templates
- **[API Reference](api-reference.md)** — full method signatures with identifier options