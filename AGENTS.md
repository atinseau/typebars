# AGENTS.md — Typebars

## Project Overview

Typebars is a **type-safe Handlebars-based template engine** for generating objects or content with static type checking. It uses JSON Schema v7 for input validation and output type inference.

- **Language**: TypeScript (strict mode)
- **Runtime**: Bun
- **Linter/Formatter**: Biome (tabs, double quotes)
- **Build**: SWC (ESM + CJS dual build) + tsc (declaration files only)
- **Tests**: Bun test runner (`bun:test`)
- **Package manager**: Bun (lockfile: `bun.lock`)

## Essential Commands

```sh
# Type-check (no emit) — run FIRST to catch type errors
bun check-types

# Lint + format (auto-fix, writes in place)
bun biome check --write --unsafe

# Run all unit tests (suppress passing tests, show only failures + summary)
bun test 2>&1 | grep -vE "^\(pass\)|^✓|^$|^tests/|^bun test"

# Run only a specific test file (use to validate a targeted change)
bun test tests/<file>.spec.ts 2>&1 | grep -vE "^\(pass\)|^✓|^$|^tests/|^bun test"

# Full build (clean + SWC + tsc + postbuild)
bun run build

# Integration tests only (run after build)
bun test:integration
```

**Always run `bun check-types` and `bun test` before considering any change complete.**

## Repository Structure

```
src/
├── index.ts              # Public re-exports (Typebars, defineHelper, errors)
├── typebars.ts           # Main engine class — orchestrates parse → analyze → execute
├── parser.ts             # Handlebars AST parsing, identifier syntax, fast-path detection
├── analyzer.ts           # Static analysis: input validation + output schema inference
├── executor.ts           # Template execution with 4 execution modes (single expr, fast-path, single block, mixed)
├── compiled-template.ts  # Compile-once / execute-many pattern (CompiledTemplate)
├── schema-resolver.ts    # JSON Schema navigation: $ref, combinators, additionalProperties, array items
├── errors.ts             # Error hierarchy: TemplateError → Parse/Analysis/Runtime/UnsupportedSchema
├── types.ts              # All public types, interfaces, diagnostic codes, defineHelper()
├── utils.ts              # Shared utilities: deepEqual, LRUCache, aggregateObjectAnalysis, aggregateArrayAnalysis (with minItems/maxItems)
└── helpers/
    ├── index.ts           # Re-exports for helper modules
    ├── helper-factory.ts  # Abstract HelperFactory base class + HelperRegistry interface
    ├── math-helpers.ts    # Built-in math helpers (add, subtract, math, abs, round…)
    ├── logical-helpers.ts # Built-in logical/comparison helpers (eq, lt, not, compare…)
    └── utils.ts           # toNumber() shared utility

tests/
├── fixtures.ts               # Shared userSchema + userData used across test suites
├── analyzer.spec.ts           # Static analysis tests (output inference, diagnostics)
├── array-bounds.spec.ts       # Array minItems/maxItems output schema tests
├── parser.spec.ts             # Parsing and AST tests
├── executor.spec.ts           # Execution tests
├── engine.spec.ts             # Typebars class integration tests
├── schema-resolver.spec.ts    # Schema resolution tests ($ref, combinators)
├── math-helpers.spec.ts       # Math helper tests
├── logical-helpers.spec.ts    # Logical helper tests
├── map-helpers.spec.ts        # Map helper tests ({{ map collection "prop" }})
├── sub-expression.spec.ts     # Sub-expression tests
├── conditional-schema.spec.ts # Conditional schema handling tests
├── colon-syntax.spec.ts       # Template identifier {{key:N}} tests
├── template-identifiers.spec.ts
├── schema-type-coercion.spec.ts   # coerceSchema output type coercion tests
├── coerce-execution.spec.ts       # coerceSchema execution-time tests
├── exclude-template-expression.spec.ts # excludeTemplateExpression option tests
├── root-token.spec.ts         # $root token tests
├── edge-cases.spec.ts         # Edge case tests
├── utils.spec.ts              # Utility function unit tests (deepEqual, LRUCache…)
├── migration-interop.spec.ts  # Migration / interoperability tests
└── integration/               # Post-build import tests (ESM + CJS)
```

## Architecture — Data Flow

```
Template string
    │
    ▼
  parse()          → hbs.AST.Program         [parser.ts]
    │
    ├──▶ analyze()  → AnalysisResult          [analyzer.ts]
    │       uses SchemaResolver               [schema-resolver.ts]
    │       returns { valid, diagnostics, outputSchema }
    │
    └──▶ execute()  → unknown                 [executor.ts]
            4 modes: single-expr | fast-path | single-block | mixed
            uses Handlebars.compile() with LRU cache
```

The `Typebars` class in `typebars.ts` orchestrates this pipeline and manages:
- AST cache (LRU) — avoids re-parsing
- Compilation cache (LRU) — avoids re-compiling Handlebars templates
- Isolated Handlebars environment per instance (custom helpers)
- `CompiledTemplate` for compile-once / execute-many pattern

## Code Conventions

### TypeScript Style

- **Strict mode** is enabled (`strict: true` in tsconfig).
- **`noUncheckedIndexedAccess: true`** — always handle `undefined` from index access.
- Use `type` imports: `import type { JSONSchema7 } from "json-schema"`.
- Use `.ts` extensions in source imports (the postbuild script rewrites them to `.js`).
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Use `readonly` on fields/parameters that should not be mutated.
- No `any` unless absolutely necessary — use `unknown` and narrow.
- Biome rule `noStaticOnlyClass` is OFF — static-only classes are allowed.
- Biome rule `noThenProperty` is OFF.

### Code Organization Pattern

Every source module follows this structure:
1. **Imports** (type imports first, then value imports)
2. **Module doc comment** (using `// ─── Section Name ───` separators)
3. **Types/interfaces** specific to the module
4. **Internal/private functions**
5. **Public API** (exported functions/classes)

Use the `// ─── Section Name ───` separator pattern for visual structure (see existing files).

### Error Handling

- Use the error hierarchy in `errors.ts`: `TemplateParseError`, `TemplateAnalysisError`, `TemplateRuntimeError`, `UnsupportedSchemaError`.
- Use the factory functions: `createPropertyNotFoundMessage()`, `createTypeMismatchMessage()`, etc.
- Diagnostics use structured `TemplateDiagnostic` objects with `code`, `severity`, `message`, `loc`, `source`, `details`.
- Diagnostic codes are defined in `types.ts` as the `DiagnosticCode` union type.

### Testing Patterns

- Use `describe` + `test` from `bun:test` (not `it`).
- Import shared fixtures from `tests/fixtures.ts` (`userSchema`, `userData`).
- Group related tests under nested `describe` blocks.
- Test names follow pattern: `"description → expected outcome"`.
- Always test both valid and invalid cases for analysis.
- Always verify `outputSchema` shape, not just `valid: true/false`.
- When adding a new feature to the analyzer, add corresponding executor tests.
- **Every new feature or critical behavior change MUST include unit tests.** Do not consider a feature complete without corresponding tests covering: valid cases, invalid/error cases, edge cases (empty input, nested structures), and output schema shape. This is non-negotiable — tests must be written automatically alongside the implementation, not as a separate follow-up step.

### JSON Schema Conventions

- This project works exclusively with JSON Schema Draft 7 (`JSONSchema7` from `json-schema`).
- `if/then/else` conditional schemas are explicitly rejected — use `oneOf`/`anyOf`/`allOf` instead.
- `$ref` resolution only supports internal references: `#/definitions/Foo` or `#/$defs/Foo`.
- The `additionalProperties` keyword is fully supported (boolean or schema).

## Token Efficiency Guidelines

### Targeted File Reading

- **Do NOT read the entire codebase.** Start by reading this file and `src/index.ts` to understand the public API.
- Read only the files directly relevant to the current task.
- Use `grep` to find symbols, function names, or patterns instead of reading entire files.
- For understanding a feature's flow, follow the data path: `typebars.ts` → `parser.ts` → `analyzer.ts` or `executor.ts`.

### Efficient Search Commands

```sh
# Find where a function/type is defined (targeted grep)
grep -rn "function analyzeFromAst" src/
grep -rn "export.*DiagnosticCode" src/

# Find usages of a function
grep -rn "analyzeFromAst" src/ --include="*.ts"

# Find test files related to a feature
grep -rn "describe.*analyzer" tests/

# Find all exports from the package
grep -rn "^export" src/index.ts
```

### Minimal Context Strategy

1. **For bug fixes**: Read the failing test → grep for the relevant function → read only that function and its direct dependencies.
2. **For new features**: Read `types.ts` for type definitions → read the module you'll modify → read the corresponding test file for patterns.
3. **For test additions**: Read `tests/fixtures.ts` + the existing test file for the module → write tests following the same pattern.
4. **For helper additions**: Read `src/helpers/helper-factory.ts` for the abstract base → read one existing helper file (e.g., `math-helpers.ts`) as a reference → implement the new helper following the same pattern.

### Command Output Optimization

```sh
# Check types — output is minimal (only errors)
bun check-types

# Run a single test file to verify a change (not the full suite, filtered output)
bun test tests/analyzer.spec.ts 2>&1 | grep -vE "^\(pass\)|^✓|^$|^tests/|^bun test"

# Lint only changed files (if you know them)
bun biome check --write --unsafe src/analyzer.ts
```

> **Why filter test output?** Bun writes everything (passes + failures) to stderr.
> The `grep -vE` filter strips `(pass)` and `✓` lines, empty lines, file headers,
> and the version banner — leaving only failures, error details, and the summary line.
> This drastically reduces output tokens on green test runs.

## Anti-Patterns to Avoid

- **Do NOT** use `JSON.stringify` for deep comparison — use `deepEqual()` from `utils.ts`.
- **Do NOT** create a new Handlebars instance outside of `Typebars` — each engine manages its own isolated environment.
- **Do NOT** bypass the LRU cache by calling `Handlebars.parse()` or `Handlebars.compile()` directly — use `parse()` from `parser.ts` and let the engine cache manage compilation.
- **Do NOT** add `if/then/else` support to the schema resolver — this is an intentional design decision (see `assertNoConditionalSchema`).
- **Do NOT** modify `scripts/postbuild.ts` unless fixing import rewriting bugs — it handles `.ts` → `.js` extension rewriting for the dual ESM/CJS build.
- **Do NOT** add dependencies without strong justification — this is a lightweight library with minimal deps (`handlebars`, `json-schema-to-ts`).
- **Do NOT** use `console.log` in library source code — errors should be communicated via the diagnostic system or thrown errors.
- **Do NOT** write tests that depend on execution order — each test must be independent.
- **Do NOT** hardcode values to make tests pass — implement the actual logic that solves the problem generally.
- **Do NOT** derive output type coercion from `inputSchema` — use an explicit `coerceSchema` in `AnalyzeOptions`. The `inputSchema` is strictly for input variable validation.

## Key Design Decisions

1. **Four execution modes** in `executor.ts` (single-expr → fast-path → single-block → mixed) — ordered from fastest to most general. Preserve this order.
2. **Discriminated union for `CompiledTemplate`** — uses `TemplateState` with `kind: "template" | "literal" | "object" | "array"`. Always use `switch` exhaustive matching.
3. **`HelperFactory` abstract base** — all helper packs must extend this class and implement `buildDefinitions()`.
4. **`TemplateInput` union type** — the engine accepts `string | number | boolean | null | TemplateInputArray | TemplateInputObject`. Use `isArrayInput()`, `isLiteralInput()`, and `isObjectInput()` type guards. **Important:** always check `isArrayInput()` before `isObjectInput()` because arrays are also `typeof "object"` in JS.
5. **Schema simplification** — `simplifySchema()` deduplicates `oneOf`/`anyOf` branches and unwraps single-element arrays. Always simplify output schemas.
6. **Template identifiers `{{key:N}}`** — identifier is always on the last path segment. Parsed by `extractExpressionIdentifier()`.
7. **`AnalyzeOptions` object** — `analyze()`, `validate()`, and `analyzeAndExecute()` accept an optional `AnalyzeOptions` object (not positional args) with `identifierSchemas?` and `coerceSchema?`. The `inputSchema` describes available variables for validation; it **never** influences output type coercion.
8. **`coerceSchema` for output type coercion** — by default, static literal values (`"123"`, `"true"`, `"null"`) are auto-detected by `detectLiteralType`. An explicit `coerceSchema` in `AnalyzeOptions` overrides this for static content only. Handlebars expressions, mixed templates, and JS primitive literals are never affected by `coerceSchema`. For object templates, `coerceSchema` is resolved per-property via `resolveSchemaPath()` and propagated recursively to children.
9. **Array bounds (`minItems`/`maxItems`)** — `aggregateArrayAnalysis` and `aggregateArrayAnalysisAndExecution` always emit `minItems: length, maxItems: length` in the output schema, because literal template arrays (`["{{name}}", "static"]`) have a statically-known element count. This applies to both the normal and `excludeTemplateExpression` paths (where `length` reflects the filtered count). Data-dependent arrays (e.g. `{{ map }}` helper, `{{tags}}` expression) do **not** have bounds — their size depends on runtime input.

## Validation Checklist

Before completing any change:

1. `bun check-types` passes with no errors
2. `bun biome check --write --unsafe` produces no remaining lint errors
3. `bun test 2>&1 | grep -vE "^\(pass\)|^✓|^$|^tests/|^bun test"` shows `0 fail`
4. New code follows the patterns in this document
5. New public APIs are exported from `src/index.ts`
6. New features have corresponding unit tests in `tests/` — this is **mandatory**, not optional
