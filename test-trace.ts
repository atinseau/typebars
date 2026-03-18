import type { JSONSchema7 } from "json-schema";
import { analyze } from "./src/analyzer.ts";

const inputSchema = {
	type: "object",
	properties: {
		accountId: { type: "string" },
		accountDepartmentId: { type: "string" },
	},
	required: ["accountId"],
} as JSONSchema7;

// Test case: array with optional property reference
const result = analyze(["{{accountDepartmentId}}"], inputSchema);

console.log("=== Array with optional property ===");
console.log("Output schema:", JSON.stringify(result.outputSchema, null, 2));
console.log(
	"Expected: items should include null type since property is optional",
);

// For comparison, test with required property
const result2 = analyze(["{{accountId}}"], inputSchema);

console.log("\n=== Array with required property ===");
console.log("Output schema:", JSON.stringify(result2.outputSchema, null, 2));
