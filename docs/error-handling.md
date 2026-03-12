# Error Handling

> **[← Back to README](../README.md)** | **Related:** [Static Analysis](static-analysis.md) · [Execution](execution.md) · [API Reference](api-reference.md)

Typebars uses a structured error hierarchy for different failure modes. All error classes extend the base `TemplateError` class and provide rich context for debugging and API responses.

---

## Table of Contents

- [Error Hierarchy](#error-hierarchy)
- [`TemplateParseError`](#templateparseerror)
- [`TemplateAnalysisError`](#templateanalysiserror)
  - [Properties](#properties)
  - [`toJSON()` for API Responses](#tojson-for-api-responses)
- [`TemplateRuntimeError`](#templateruntimeerror)
- [`UnsupportedSchemaError`](#unsupportedschemaerror)
- [Diagnostics](#diagnostics)
  - [Diagnostic Structure](#diagnostic-structure)
  - [Diagnostic Codes](#diagnostic-codes)
- [Syntax Validation](#syntax-validation)
- [Error vs. Diagnostic](#error-vs-diagnostic)

---

## Error Hierarchy

```
TemplateError (base)
├── TemplateParseError       — invalid Handlebars syntax
├── TemplateAnalysisError    — static analysis failed (with diagnostics)
├── TemplateRuntimeError     — runtime execution failure
└── UnsupportedSchemaError   — schema uses unsupported features (e.g. if/then/else)
```

All error classes are exported from `typebars`:

```ts
import {
  TemplateError,
  TemplateParseError,
  TemplateAnalysisError,
  TemplateRuntimeError,
  UnsupportedSchemaError,
} from "typebars";
```

---

## `TemplateParseError`

Thrown when the template has invalid Handlebars syntax. This happens during `parse()`, `analyze()`, `execute()`, or `compile()`.

```ts
try {
  engine.execute("{{#if}}unclosed", {});
} catch (err) {
  if (err instanceof TemplateParseError) {
    err.message; // → "Parse error: ..."
    err.loc;     // → { line: number, column: number } (if available)
  }
}
```

Common causes:
- Unclosed block helpers (`{{#if}}` without `{{/if}}`)
- Mismatched block helpers (`{{#if}}...{{/unless}}`)
- Invalid Handlebars syntax

---

## `TemplateAnalysisError`

Thrown when `execute()` is called with a `schema` option and the template fails validation. This error wraps the full list of [diagnostics](#diagnostics) from the static analysis.

```ts
try {
  engine.execute("{{unknown}}", data, {
    schema: { type: "object", properties: { name: { type: "string" } } },
  });
} catch (err) {
  if (err instanceof TemplateAnalysisError) {
    err.diagnostics;  // TemplateDiagnostic[] — all diagnostics
    err.errors;       // TemplateDiagnostic[] — only severity: "error"
    err.warnings;     // TemplateDiagnostic[] — only severity: "warning"
    err.errorCount;   // number
    err.warningCount; // number
  }
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `diagnostics` | `TemplateDiagnostic[]` | All diagnostics (errors + warnings) |
| `errors` | `TemplateDiagnostic[]` | Only diagnostics with `severity: "error"` |
| `warnings` | `TemplateDiagnostic[]` | Only diagnostics with `severity: "warning"` |
| `errorCount` | `number` | Number of errors |
| `warningCount` | `number` | Number of warnings |

### `toJSON()` for API Responses

The `toJSON()` method produces a clean, serializable structure suitable for HTTP API responses:

```ts
try {
  engine.execute("{{unknown}}", data, { schema });
} catch (err) {
  if (err instanceof TemplateAnalysisError) {
    // Express / Hono / Fastify / etc.
    res.status(400).json(err.toJSON());
  }
}
```

The output structure:

```ts
{
  name: "TemplateAnalysisError",
  message: "Static analysis failed with 1 error(s): ...",
  errorCount: 1,
  warningCount: 0,
  diagnostics: [
    {
      severity: "error",
      code: "UNKNOWN_PROPERTY",
      message: "Property \"unknown\" does not exist ...",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 11 } },
      source: "unknown",
      details: { path: "unknown", availableProperties: ["name"] },
    },
  ],
}
```

---

## `TemplateRuntimeError`

Thrown when the template execution fails at runtime (after parsing and optional analysis have succeeded). This covers Handlebars runtime errors and internal execution failures.

```ts
try {
  engine.execute(someTemplate, data);
} catch (err) {
  if (err instanceof TemplateRuntimeError) {
    err.message; // Description of the runtime failure
  }
}
```

---

## `UnsupportedSchemaError`

Thrown when the input schema uses features that Typebars intentionally does not support. Currently, this applies to JSON Schema `if`/`then`/`else` conditional schemas.

See [Conditional Schemas](schema-features.md#conditional-schemas-ifthenelse) for details on this design decision.

```ts
try {
  engine.analyze("{{name}}", {
    type: "object",
    if: { properties: { type: { const: "admin" } } },
    then: { properties: { level: { type: "number" } } },
    else: { properties: { level: { type: "string" } } },
  });
} catch (err) {
  if (err instanceof UnsupportedSchemaError) {
    err.message; // → "Conditional schemas (if/then/else) are not supported ..."
  }
}
```

> **Recommendation:** Use `oneOf`, `anyOf`, or `allOf` [combinators](schema-features.md#combinators-allof-anyof-oneof) instead of `if`/`then`/`else`.

---

## Diagnostics

Diagnostics are structured objects produced by the [static analyzer](static-analysis.md). They are returned in `AnalysisResult.diagnostics` and wrapped in `TemplateAnalysisError.diagnostics`.

### Diagnostic Structure

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

| Field | Description |
|-------|-------------|
| `severity` | `"error"` blocks execution (when using schema validation); `"warning"` is informational |
| `code` | Machine-readable [diagnostic code](#diagnostic-codes) |
| `message` | Human-readable error description |
| `loc` | Source location in the template (line and column, 1-based) |
| `source` | The original expression text (e.g. `"unknown"`, `"badProp"`) |
| `details` | Structured context — varies by diagnostic code |

### Diagnostic Codes

| Code | Severity | Description | Details |
|------|----------|-------------|---------|
| `UNKNOWN_PROPERTY` | error | Property doesn't exist in the schema | `path`, `availableProperties` |
| `TYPE_MISMATCH` | error | Incompatible type (e.g. `{{#each}}` on a non-array, or wrong helper argument type) | `expected`, `actual`, `helperName` |
| `MISSING_ARGUMENT` | error | Block helper or registered helper used without a required argument | `helperName` |
| `UNKNOWN_HELPER` | warning | Unknown block helper (neither built-in nor registered) | `helperName` |
| `UNANALYZABLE` | warning | Expression can't be statically analyzed | — |
| `MISSING_IDENTIFIER_SCHEMAS` | error | `{{key:N}}` syntax used but no `identifierSchemas` provided | — |
| `UNKNOWN_IDENTIFIER` | error | Identifier N not found in the provided `identifierSchemas` | `identifier` |
| `IDENTIFIER_PROPERTY_NOT_FOUND` | error | Property doesn't exist in the identifier's schema | `path`, `identifier` |
| `PARSE_ERROR` | error | Invalid Handlebars syntax | — |
| `ROOT_PATH_TRAVERSAL` | error | `$root` used with path traversal (e.g. `$root.name`) | `path` |

For identifier-related diagnostics, see [Template Identifiers — Identifier Diagnostics](identifiers.md#identifier-diagnostics).

For `ROOT_PATH_TRAVERSAL`, see [Advanced Features — `$root` Token](advanced.md#root-token).

---

## Syntax Validation

For live editors or quick checks, use `isValidSyntax()` to verify Handlebars syntax **without** providing a schema:

```ts
engine.isValidSyntax("Hello {{name}}");           // true
engine.isValidSyntax("{{#if x}}yes{{/if}}");      // true
engine.isValidSyntax("{{#if x}}oops{{/unless}}"); // false — mismatched block
engine.isValidSyntax("{{#if}}unclosed");           // false — missing close tag
```

This method only checks syntax — it does **not** validate property names, types, or any schema-related constraints. For full validation, use [`analyze()`](api-reference.md#methods) or [`validate()`](api-reference.md#methods).

---

## Error vs. Diagnostic

It's important to understand the distinction:

| Concept | When | How |
|---------|------|-----|
| **Diagnostic** | Returned by `analyze()`, `validate()`, `analyzeAndExecute()` | Part of `AnalysisResult.diagnostics`. Non-throwing — you inspect the result |
| **Error (thrown)** | Thrown by `execute()` when a `schema` option is provided and analysis fails | `TemplateAnalysisError` wraps the diagnostics |
| **Error (thrown)** | Thrown by any method on invalid syntax | `TemplateParseError` |
| **Error (thrown)** | Thrown on unsupported schema features | `UnsupportedSchemaError` |

In other words:
- **`analyze()` never throws** on validation failures — it returns `{ valid: false, diagnostics: [...] }`
- **`execute()` with a `schema` option throws** a `TemplateAnalysisError` if analysis fails
- **`execute()` without a `schema` option** does not run static analysis and will not throw analysis errors

```ts
// Non-throwing — inspect the result
const result = engine.analyze("{{unknown}}", schema);
if (!result.valid) {
  console.log(result.diagnostics); // Handle diagnostics programmatically
}

// Throwing — catches errors
try {
  engine.execute("{{unknown}}", data, { schema });
} catch (err) {
  if (err instanceof TemplateAnalysisError) {
    // Same diagnostics, but thrown as an error
    console.log(err.diagnostics);
  }
}
```

---

## What's Next?

- **[Static Analysis](static-analysis.md)** — how diagnostics are produced and what they mean
- **[Execution](execution.md)** — when errors are thrown during execution
- **[Advanced Features](advanced.md)** — `$root` token and `ROOT_PATH_TRAVERSAL`
- **[API Reference](api-reference.md)** — full method signatures and error class exports