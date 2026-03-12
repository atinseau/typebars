# API Reference

> **[← Back to README](../README.md)** | **Related:** [Getting Started](getting-started.md) · [Static Analysis](static-analysis.md) · [Execution](execution.md) · [Error Handling](error-handling.md)

Complete reference for the Typebars public API — classes, methods, types, and options.

---

## Table of Contents

- [`Typebars` Class](#typebars-class)
  - [Constructor](#constructor)
  - [`analyze()`](#analyze)
  - [`validate()`](#validate)
  - [`execute()`](#execute)
  - [`analyzeAndExecute()`](#analyzeandexecute)
  - [`compile()`](#compile)
  - [`isValidSyntax()`](#isvalidsyntax)
  - [`registerHelper()`](#registerhelper)
  - [`unregisterHelper()`](#unregisterhelper)
  - [`hasHelper()`](#hashelper)
  - [`clearCaches()`](#clearcaches)
- [`CompiledTemplate` Class](#compiledtemplate-class)
  - [`execute()`](#compiledtemplate-execute)
  - [`analyze()`](#compiledtemplate-analyze)
  - [`validate()`](#compiledtemplate-validate)
  - [`analyzeAndExecute()`](#compiledtemplate-analyzeandexecute)
- [Types](#types)
  - [`TemplateInput`](#templateinput)
  - [`TemplateData`](#templatedata)
  - [`TemplateInputObject`](#templateinputobject)
  - [`TemplateInputArray`](#templateinputarray)
  - [`AnalysisResult`](#analysisresult)
  - [`ValidationResult`](#validationresult)
  - [`TemplateDiagnostic`](#templatediagnostic)
  - [`DiagnosticCode`](#diagnosticcode)
  - [`DiagnosticDetails`](#diagnosticdetails)
- [Options](#options)
  - [`TemplateEngineOptions`](#templateengineoptions)
  - [`AnalyzeOptions`](#analyzeoptions)
  - [`ExecuteOptions`](#executeoptions)
  - [`AnalyzeAndExecuteOptions`](#analyzeandexecuteoptions)
- [Helper Types](#helper-types)
  - [`HelperDefinition`](#helperdefinition)
  - [`HelperConfig`](#helperconfig)
  - [`HelperParam`](#helperparam)
  - [`defineHelper()`](#definehelper)
- [Error Classes](#error-classes)
- [Type Guards](#type-guards)
- [Exports](#exports)

---

## `Typebars` Class

The main engine class. Each instance has its own isolated Handlebars environment, helper registry, and LRU caches.

```ts
import { Typebars } from "typebars";
```

### Constructor

```ts
new Typebars(options?: TemplateEngineOptions)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.astCacheSize` | `number` | `256` | LRU cache size for parsed ASTs |
| `options.compilationCacheSize` | `number` | `256` | LRU cache size for compiled Handlebars templates |
| `options.helpers` | `HelperConfig[]` | `[]` | Custom helpers to register at construction time |

```ts
const engine = new Typebars({
  astCacheSize: 512,
  compilationCacheSize: 512,
  helpers: [
    {
      name: "uppercase",
      fn: (value) => String(value).toUpperCase(),
      params: [{ name: "value", type: { type: "string" } }],
      returnType: { type: "string" },
    },
  ],
});
```

Built-in helpers ([math](helpers.md#math-helpers), [logical](helpers.md#logical--comparison-helpers), [map](helpers.md#map-helper)) are automatically registered before custom helpers.

---

### `analyze()`

Statically validates a template against an input schema and infers the output schema.

```ts
analyze(
  template: TemplateInput,
  inputSchema?: JSONSchema7,
  options?: AnalyzeOptions,
): AnalysisResult
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `template` | [`TemplateInput`](#templateinput) | The template to analyze |
| `inputSchema` | `JSONSchema7` | JSON Schema describing available variables (default: `{}`) |
| `options` | [`AnalyzeOptions`](#analyzeoptions) | Optional — identifier schemas, coercion schema, expression filtering |

**Returns:** [`AnalysisResult`](#analysisresult) — `{ valid, diagnostics, outputSchema }`

**Throws:** [`TemplateParseError`](error-handling.md#templateparseerror) on invalid syntax, [`UnsupportedSchemaError`](error-handling.md#unsupportedschemaerror) on `if`/`then`/`else` schemas.

**Does not throw** on validation failures — check `result.valid` and `result.diagnostics` instead.

```ts
const result = engine.analyze("{{name}}", schema);
if (result.valid) {
  console.log(result.outputSchema); // { type: "string" }
} else {
  console.log(result.diagnostics);  // TemplateDiagnostic[]
}
```

See [Static Analysis](static-analysis.md) for detailed behavior.

---

### `validate()`

Like `analyze()` but without computing the `outputSchema`. Slightly lighter — useful when you only need validation.

```ts
validate(
  template: TemplateInput,
  inputSchema?: JSONSchema7,
  options?: AnalyzeOptions,
): ValidationResult
```

**Returns:** [`ValidationResult`](#validationresult) — `{ valid, diagnostics }` (no `outputSchema`).

```ts
const result = engine.validate("{{name}}", schema);
result.valid;       // boolean
result.diagnostics; // TemplateDiagnostic[]
```

---

### `execute()`

Renders a template with data. Optionally validates against a schema first.

```ts
execute(
  template: TemplateInput,
  data: TemplateData,
  options?: ExecuteOptions,
): unknown
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `template` | [`TemplateInput`](#templateinput) | The template to execute |
| `data` | [`TemplateData`](#templatedata) | The data context for rendering |
| `options` | [`ExecuteOptions`](#executeoptions) | Optional — schema for pre-execution validation, identifier data, coercion, expression filtering |

**Returns:** The rendered value. The type depends on the template structure — see [Type Preservation](execution.md#type-preservation).

**Throws:**
- [`TemplateParseError`](error-handling.md#templateparseerror) on invalid syntax
- [`TemplateAnalysisError`](error-handling.md#templateanalysiserror) if `options.schema` is provided and analysis fails
- [`TemplateRuntimeError`](error-handling.md#templateruntimeerror) on Handlebars runtime errors

```ts
engine.execute("{{age}}", { age: 30 });         // → 30 (number)
engine.execute("Hello {{name}}", { name: "A" }); // → "Hello A" (string)
engine.execute(42, {});                           // → 42 (literal passthrough)
```

---

### `analyzeAndExecute()`

Performs both static analysis and execution in a single call. If analysis fails, execution is skipped and `value` is `undefined`.

```ts
analyzeAndExecute(
  template: TemplateInput,
  inputSchema: JSONSchema7,
  data: TemplateData,
  options?: AnalyzeAndExecuteOptions,
): { analysis: AnalysisResult; value: unknown }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `template` | [`TemplateInput`](#templateinput) | The template to process |
| `inputSchema` | `JSONSchema7` | JSON Schema describing available variables |
| `data` | [`TemplateData`](#templatedata) | The data context for rendering |
| `options` | [`AnalyzeAndExecuteOptions`](#analyzeandexecuteoptions) | Optional — identifiers, coercion, expression filtering |

**Returns:** `{ analysis: AnalysisResult, value: unknown }` — `value` is `undefined` if `analysis.valid` is `false`.

```ts
const { analysis, value } = engine.analyzeAndExecute("{{age}}", schema, data);
analysis.outputSchema; // { type: "number" }
value;                 // 30
```

---

### `compile()`

Parses a template once and returns a reusable [`CompiledTemplate`](#compiledtemplate-class). Avoids re-parsing on repeated executions.

```ts
compile(template: TemplateInput): CompiledTemplate
```

**Returns:** [`CompiledTemplate`](#compiledtemplate-class)

**Throws:** [`TemplateParseError`](error-handling.md#templateparseerror) on invalid syntax.

```ts
const tpl = engine.compile("Hello {{name}}!");
tpl.execute({ name: "Alice" }); // → "Hello Alice!"
tpl.execute({ name: "Bob" });   // → "Hello Bob!"
```

See [Compiled Templates](execution.md#compiled-templates) for detailed usage.

---

### `isValidSyntax()`

Checks if a template string has valid Handlebars syntax. Does **not** validate against a schema.

```ts
isValidSyntax(template: string): boolean
```

```ts
engine.isValidSyntax("Hello {{name}}");           // true
engine.isValidSyntax("{{#if x}}oops{{/unless}}"); // false
```

See [Syntax Validation](error-handling.md#syntax-validation).

---

### `registerHelper()`

Registers a custom helper with type metadata for static analysis.

```ts
registerHelper(name: string, definition: HelperDefinition): this
```

Returns `this` for chaining.

```ts
engine
  .registerHelper("upper", {
    fn: (v) => String(v).toUpperCase(),
    returnType: { type: "string" },
  })
  .registerHelper("lower", {
    fn: (v) => String(v).toLowerCase(),
    returnType: { type: "string" },
  });
```

See [Custom Helpers](helpers.md#custom-helpers) for detailed examples.

---

### `unregisterHelper()`

Removes a helper (including built-in ones). Invalidates the compilation cache.

```ts
unregisterHelper(name: string): this
```

Returns `this` for chaining.

---

### `hasHelper()`

Checks whether a helper is registered on this instance.

```ts
hasHelper(name: string): boolean
```

```ts
engine.hasHelper("add");       // true (built-in)
engine.hasHelper("custom");    // false
```

---

### `clearCaches()`

Clears all internal caches (AST + compilation). Useful after configuration changes or to free memory.

```ts
clearCaches(): void
```

---

## `CompiledTemplate` Class

Returned by [`engine.compile()`](#compile). Provides the same operations as the engine but without re-parsing.

Uses a discriminated union internally (`TemplateState`) with kinds: `"template"`, `"literal"`, `"object"`, and `"array"`.

### `execute()` {#compiledtemplate-execute}

```ts
execute(data: TemplateData, options?: ExecuteOptions): unknown
```

### `analyze()` {#compiledtemplate-analyze}

```ts
analyze(inputSchema: JSONSchema7, options?: AnalyzeOptions): AnalysisResult
```

### `validate()` {#compiledtemplate-validate}

```ts
validate(inputSchema: JSONSchema7, options?: AnalyzeOptions): ValidationResult
```

### `analyzeAndExecute()` {#compiledtemplate-analyzeandexecute}

```ts
analyzeAndExecute(
  inputSchema: JSONSchema7,
  data: TemplateData,
  options?: AnalyzeAndExecuteOptions,
): { analysis: AnalysisResult; value: unknown }
```

> **Note:** The parameter order for `CompiledTemplate` methods differs from `Typebars` methods — there is no `template` parameter since the template is already compiled.

---

## Types

### `TemplateInput`

The input type accepted by the template engine. A recursive union:

```ts
type TemplateInput =
  | string              // Handlebars template (parsed and executed)
  | number              // Literal passthrough
  | boolean             // Literal passthrough
  | null                // Literal passthrough
  | TemplateInputArray  // Array where each element is a TemplateInput
  | TemplateInputObject // Object where each property is a TemplateInput
```

See [Templates](templates.md) for object and array template behavior.

### `TemplateData`

The data context accepted by `execute()` and `analyzeAndExecute()`:

```ts
type TemplateData =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
```

### `TemplateInputObject`

```ts
interface TemplateInputObject {
  [key: string]: TemplateInput;
}
```

### `TemplateInputArray`

```ts
type TemplateInputArray = TemplateInput[];
```

### `AnalysisResult`

Returned by `analyze()` and `analyzeAndExecute()`:

```ts
interface AnalysisResult {
  valid: boolean;                    // true if no error-severity diagnostics
  diagnostics: TemplateDiagnostic[]; // all diagnostics (errors + warnings)
  outputSchema: JSONSchema7;         // inferred output type
}
```

### `ValidationResult`

Returned by `validate()`:

```ts
interface ValidationResult {
  valid: boolean;
  diagnostics: TemplateDiagnostic[];
}
```

### `TemplateDiagnostic`

A structured diagnostic object. See [Diagnostics](error-handling.md#diagnostics) for full details.

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
  details?: DiagnosticDetails;
}
```

### `DiagnosticCode`

A union type of all possible diagnostic codes:

```ts
type DiagnosticCode =
  | "UNKNOWN_PROPERTY"
  | "TYPE_MISMATCH"
  | "MISSING_ARGUMENT"
  | "UNKNOWN_HELPER"
  | "UNANALYZABLE"
  | "MISSING_IDENTIFIER_SCHEMAS"
  | "UNKNOWN_IDENTIFIER"
  | "IDENTIFIER_PROPERTY_NOT_FOUND"
  | "PARSE_ERROR"
  | "ROOT_PATH_TRAVERSAL";
```

See [Diagnostic Codes](error-handling.md#diagnostic-codes) for descriptions of each code.

### `DiagnosticDetails`

Optional structured context attached to diagnostics:

```ts
interface DiagnosticDetails {
  path?: string;
  helperName?: string;
  expected?: string;
  actual?: string;
  availableProperties?: string[];
  identifier?: number;
}
```

---

## Options

### `TemplateEngineOptions`

Passed to the [`Typebars` constructor](#constructor):

```ts
interface TemplateEngineOptions {
  astCacheSize?: number;         // LRU cache for parsed ASTs (default: 256)
  compilationCacheSize?: number; // LRU cache for Handlebars compilations (default: 256)
  helpers?: HelperConfig[];      // Custom helpers to register at construction
}
```

### `AnalyzeOptions`

Passed to `analyze()`, `validate()`, and the analysis portion of `analyzeAndExecute()`:

```ts
interface AnalyzeOptions {
  identifierSchemas?: Record<number, JSONSchema7>;
  coerceSchema?: JSONSchema7;
  excludeTemplateExpression?: boolean;
}
```

| Field | Description | Docs |
|-------|-------------|------|
| `identifierSchemas` | Schemas by identifier number for the `{{key:N}}` syntax | [Identifiers](identifiers.md) |
| `coerceSchema` | Explicit coercion schema overriding auto-detection for static literals | [coerceSchema](advanced.md#output-type-coercion-coerceschema) |
| `excludeTemplateExpression` | When `true`, exclude entries containing `{{…}}` from the output | [excludeTemplateExpression](advanced.md#exclude-template-expressions) |

### `ExecuteOptions`

Passed to `execute()`:

```ts
interface ExecuteOptions {
  schema?: JSONSchema7;
  identifierSchemas?: Record<number, JSONSchema7>;
  identifierData?: Record<number, Record<string, unknown>>;
  coerceSchema?: JSONSchema7;
  excludeTemplateExpression?: boolean;
}
```

| Field | Description | Docs |
|-------|-------------|------|
| `schema` | When provided, runs `analyze()` before execution and throws [`TemplateAnalysisError`](error-handling.md#templateanalysiserror) on failure | [Error Handling](error-handling.md#error-vs-diagnostic) |
| `identifierSchemas` | Schemas by identifier (for pre-execution analysis) | [Identifiers](identifiers.md) |
| `identifierData` | Data by identifier number | [Identifiers](identifiers.md#execution-with-identifier-data) |
| `coerceSchema` | Output type coercion for static literals | [coerceSchema](advanced.md#output-type-coercion-coerceschema) |
| `excludeTemplateExpression` | Exclude entries with Handlebars expressions | [excludeTemplateExpression](advanced.md#exclude-template-expressions) |

### `AnalyzeAndExecuteOptions`

Passed to `analyzeAndExecute()`:

```ts
interface AnalyzeAndExecuteOptions {
  identifierSchemas?: Record<number, JSONSchema7>;
  identifierData?: Record<number, Record<string, unknown>>;
  coerceSchema?: JSONSchema7;
  excludeTemplateExpression?: boolean;
}
```

Combines the analysis and execution options (except `schema`, which is implicit).

---

## Helper Types

### `HelperDefinition`

The definition object passed to [`registerHelper()`](#registerhelper):

```ts
interface HelperDefinition {
  fn: (...args: unknown[]) => unknown;
  params?: HelperParam[];
  returnType?: JSONSchema7;
  description?: string;
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `fn` | ✅ | The helper implementation function |
| `params` | ❌ | Parameter definitions for static analysis |
| `returnType` | ❌ | JSON Schema of the return value (used for output type inference) |
| `description` | ❌ | Human-readable description |

### `HelperConfig`

Used in `TemplateEngineOptions.helpers` — a `HelperDefinition` with a required `name`:

```ts
interface HelperConfig extends HelperDefinition {
  name: string;
}
```

### `HelperParam`

Describes a single helper parameter:

```ts
interface HelperParam {
  name: string;
  type?: JSONSchema7;
  description?: string;
  optional?: boolean;
}
```

| Field | Description |
|-------|-------------|
| `name` | Parameter name (used in diagnostic messages) |
| `type` | JSON Schema the argument must conform to (for type checking) |
| `description` | Human-readable description |
| `optional` | When `true`, the argument is not required |

### `defineHelper()`

A type-safe factory function that infers TypeScript types for the `fn` arguments from the `params` JSON Schemas:

```ts
import { defineHelper } from "typebars";

const helper = defineHelper({
  name: "concat",
  params: [
    { name: "a", type: { type: "string" } },
    { name: "b", type: { type: "string" } },
  ] as const,  // ← `as const` is required for type inference
  fn: (a, b) => `${a}${b}`,  // TypeScript infers: a: string, b: string
  returnType: { type: "string" },
});
```

**Signature:**

```ts
function defineHelper<P extends readonly TypedHelperParam[]>(
  config: TypedHelperConfig<P>,
): HelperConfig
```

See [Custom Helpers — `defineHelper`](helpers.md#definehelper-type-safe) for detailed examples.

---

## Error Classes

All error classes are exported from `typebars`. See [Error Handling](error-handling.md) for detailed descriptions.

```ts
import {
  TemplateError,
  TemplateParseError,
  TemplateAnalysisError,
  TemplateRuntimeError,
  UnsupportedSchemaError,
} from "typebars";
```

| Class | Thrown When | Key Properties |
|-------|------------|----------------|
| `TemplateError` | Base class — not thrown directly | `message` |
| `TemplateParseError` | Invalid Handlebars syntax | `message`, `loc?` |
| `TemplateAnalysisError` | `execute()` with `schema` option fails validation | `diagnostics`, `errors`, `warnings`, `errorCount`, `warningCount`, `toJSON()` |
| `TemplateRuntimeError` | Handlebars runtime failure | `message` |
| `UnsupportedSchemaError` | Schema uses `if`/`then`/`else` | `message` |

---

## Type Guards

Exported utility functions for narrowing `TemplateInput` values:

```ts
import { isArrayInput } from "typebars";
```

| Function | Description |
|----------|-------------|
| `isArrayInput(value)` | Returns `true` if the value is a `TemplateInputArray` |

> **Important:** Always check `isArrayInput()` **before** checking for objects, because arrays are also `typeof "object"` in JavaScript.

The following type guards are available from the source module but not re-exported from the package entry point:

| Function | Description |
|----------|-------------|
| `isLiteralInput(value)` | Returns `true` if the value is `number`, `boolean`, or `null` |
| `isObjectInput(value)` | Returns `true` if the value is a `TemplateInputObject` (non-array object) |

---

## Exports

Everything exported from the `typebars` package entry point:

```ts
// Classes
export { Typebars } from "./typebars";

// Types
export type { AnalyzeOptions } from "./analyzer";
export type {
  TemplateData,
  TemplateInput,
  TemplateInputArray,
} from "./types";

// Functions
export { defineHelper, isArrayInput } from "./types";

// Errors
export {
  TemplateError,
  TemplateParseError,
  TemplateAnalysisError,
  TemplateRuntimeError,
  UnsupportedSchemaError,
} from "./errors";
```

---

## What's Next?

- **[Getting Started](getting-started.md)** — installation and quick start
- **[Static Analysis](static-analysis.md)** — detailed analysis behavior
- **[Execution](execution.md)** — type preservation and compiled templates
- **[Error Handling](error-handling.md)** — error hierarchy and diagnostics