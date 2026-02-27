// ─── CJS Import Test (Node.js) ──────────────────────────────────────────────
// This script is executed by Node.js to verify that the CommonJS build
// can be imported and used correctly via require().

const {
	Typebars,
	defineHelper,
	TemplateError,
	TemplateAnalysisError,
	TemplateParseError,
	TemplateRuntimeError,
	UnsupportedSchemaError,
} = require("../../dist/cjs/index.js");

const errors = [];

function assert(condition, message) {
	if (!condition) {
		errors.push(`FAIL: ${message}`);
	}
}

// ─── Verify exports exist ────────────────────────────────────────────────────

assert(
	typeof Typebars === "function",
	"Typebars should be a constructor function",
);
assert(typeof defineHelper === "function", "defineHelper should be a function");
assert(
	typeof TemplateError === "function",
	"TemplateError should be a constructor",
);
assert(
	typeof TemplateAnalysisError === "function",
	"TemplateAnalysisError should be a constructor",
);
assert(
	typeof TemplateParseError === "function",
	"TemplateParseError should be a constructor",
);
assert(
	typeof TemplateRuntimeError === "function",
	"TemplateRuntimeError should be a constructor",
);
assert(
	typeof UnsupportedSchemaError === "function",
	"UnsupportedSchemaError should be a constructor",
);

// ─── Verify instantiation ────────────────────────────────────────────────────

const engine = new Typebars();
assert(
	engine instanceof Typebars,
	"new Typebars() should return an instance of Typebars",
);

// ─── Verify isValidSyntax ────────────────────────────────────────────────────

assert(
	engine.isValidSyntax("Hello {{name}}") === true,
	"isValidSyntax should return true for valid template",
);
assert(
	engine.isValidSyntax("{{#if x}}") === false,
	"isValidSyntax should return false for unclosed block",
);

// ─── Verify analyze ─────────────────────────────────────────────────────────

const schema = {
	type: "object",
	properties: {
		name: { type: "string" },
		age: { type: "number" },
	},
};

const result = engine.analyze("{{name}}", schema);
assert(
	result.valid === true,
	"analyze should return valid: true for a valid template",
);
assert(result.outputSchema != null, "analyze should return an outputSchema");

// ─── Verify execute ──────────────────────────────────────────────────────────

const output = engine.execute("Hello {{name}}", { name: "World" });
assert(
	output === "Hello World",
	`execute should resolve template, got: ${JSON.stringify(output)}`,
);

// ─── Verify type preservation ────────────────────────────────────────────────

const numOutput = engine.execute("{{age}}", { age: 42 });
assert(
	numOutput === 42,
	`execute should preserve number type, got: ${JSON.stringify(numOutput)}`,
);

// ─── Verify error classes ────────────────────────────────────────────────────

const err = new TemplateError("test");
assert(err instanceof Error, "TemplateError should extend Error");
assert(
	err instanceof TemplateError,
	"TemplateError instanceof check should work",
);

const parseErr = new TemplateParseError("bad syntax");
assert(
	parseErr instanceof TemplateError,
	"TemplateParseError should extend TemplateError",
);

// ─── Verify defineHelper ─────────────────────────────────────────────────────

const helper = defineHelper({
	name: "uppercase",
	params: [{ name: "value", type: { type: "string" } }],
	fn: (value) => String(value).toUpperCase(),
	returnType: { type: "string" },
});
assert(helper.name === "uppercase", "defineHelper should preserve helper name");
assert(typeof helper.fn === "function", "defineHelper should preserve fn");

// ─── Report ──────────────────────────────────────────────────────────────────

if (errors.length > 0) {
	console.error(`[CJS/Node] ${errors.length} assertion(s) failed:`);
	for (const e of errors) {
		console.error(`  ${e}`);
	}
	process.exit(1);
} else {
	console.log("[CJS/Node] All assertions passed ✓");
}
