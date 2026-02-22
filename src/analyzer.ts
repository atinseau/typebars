import {
	detectLiteralType,
	extractExpressionIdentifier,
	extractPathSegments,
	getEffectiveBody,
	getEffectivelySingleBlock,
	getEffectivelySingleExpression,
	isThisExpression,
	parse,
} from "./parser.ts";
import {
	resolveArrayItems,
	resolveSchemaPath,
	simplifySchema,
} from "./schema-resolver.ts";
import type {
	AnalysisResult,
	JSONSchema7,
	TemplateDiagnostic,
} from "./types.ts";

// ─── Static Analyzer ─────────────────────────────────────────────────────────
// Analyse statique d'un template Handlebars par rapport à un JSON Schema v7
// décrivant le contexte disponible.
//
// Deux responsabilités :
// 1. **Validation** — vérifier que chaque référence du template existe dans le
//    schema et que les constructions (if, each, with) sont utilisées sur des
//    types compatibles.
// 2. **Inférence du type de retour** — produire un JSON Schema décrivant le
//    type de la valeur retournée par l'exécution du template.
//
// ─── Template Identifiers ────────────────────────────────────────────────────
// La syntaxe `{{key:N}}` permet de référencer une variable depuis un schema
// spécifique, identifié par un entier N. Le paramètre optionnel
// `identifierSchemas` fournit un mapping `{ [id]: JSONSchema7 }`.
//
// Règles de résolution :
// - `{{meetingId}}`   → validé contre `inputSchema` (comportement standard)
// - `{{meetingId:1}}` → validé contre `identifierSchemas[1]`
// - `{{meetingId:1}}` sans `identifierSchemas[1]` → erreur

// ─── Types internes ──────────────────────────────────────────────────────────

/** Contexte transmis récursivement pendant le parcours de l'AST */
interface AnalysisContext {
	/** Schema racine (pour résoudre les $ref) */
	root: JSONSchema7;
	/** Schema du contexte courant (change avec #each, #with) */
	current: JSONSchema7;
	/** Accumulateur de diagnostics */
	diagnostics: TemplateDiagnostic[];
	/** Schemas par identifiant de template (pour la syntaxe {{key:N}}) */
	identifierSchemas?: Record<number, JSONSchema7>;
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Analyse statiquement un template par rapport à un JSON Schema v7 décrivant
 * le contexte disponible.
 *
 * @param template           - La chaîne de template (ex: `"Hello {{user.name}}"`)
 * @param inputSchema        - JSON Schema v7 décrivant les variables disponibles
 * @param identifierSchemas  - (optionnel) Schemas par identifiant `{ [id]: JSONSchema7 }`
 * @returns Un `AnalysisResult` contenant la validité, les diagnostics et le
 *          schema de sortie inféré.
 */
export function analyze(
	template: string,
	inputSchema: JSONSchema7,
	identifierSchemas?: Record<number, JSONSchema7>,
): AnalysisResult {
	const ast = parse(template);

	const ctx: AnalysisContext = {
		root: inputSchema,
		current: inputSchema,
		diagnostics: [],
		identifierSchemas,
	};

	// Inférer le type de sortie en parcourant l'AST.
	// On distingue 3 cas (du plus spécifique au plus général) :
	//
	// 1. Expression unique `{{expr}}`
	//    → le type de retour est celui de l'expression (number, object, …)
	//
	// 2. Bloc unique `{{#if …}}…{{/if}}` (éventuellement entouré de whitespace)
	//    → on délègue à `inferBlockType` qui analyse les branches
	//
	// 3. Template mixte (texte + expressions, blocs multiples, …)
	//    → le résultat est toujours une string (concaténation)

	const outputSchema = inferProgramType(ast, ctx);

	const hasErrors = ctx.diagnostics.some((d) => d.severity === "error");

	return {
		valid: !hasErrors,
		diagnostics: ctx.diagnostics,
		outputSchema: simplifySchema(outputSchema),
	};
}

// ─── Parcours de l'AST (validation) ──────────────────────────────────────────
// Ces fonctions parcourent l'AST pour valider les références et collecter
// les diagnostics. Elles ne retournent pas de type — c'est le rôle des
// fonctions `infer*`.

/**
 * Valide un `Program` (corps d'un template ou d'un bloc).
 * Parcourt séquentiellement chaque statement.
 */
function validateProgram(program: hbs.AST.Program, ctx: AnalysisContext): void {
	for (const stmt of program.body) {
		validateStatement(stmt, ctx);
	}
}

/**
 * Dispatche la validation d'un statement selon son type AST.
 */
function validateStatement(
	stmt: hbs.AST.Statement,
	ctx: AnalysisContext,
): void {
	switch (stmt.type) {
		case "ContentStatement":
			// Texte statique — rien à valider
			break;

		case "MustacheStatement":
			validateMustache(stmt as hbs.AST.MustacheStatement, ctx);
			break;

		case "BlockStatement":
			validateBlock(stmt as hbs.AST.BlockStatement, ctx);
			break;

		case "CommentStatement":
			// Commentaire Handlebars {{!-- ... --}} — ignoré
			break;

		default:
			// Nœud AST non reconnu — on émet un warning plutôt qu'une erreur
			// pour ne pas bloquer sur des extensions futures de Handlebars.
			addDiagnostic(
				ctx,
				"warning",
				`Unsupported AST node type: "${stmt.type}"`,
				stmt,
			);
	}
}

/**
 * Valide une expression moustache `{{expression}}`.
 * Vérifie que le chemin référencé existe dans le schema courant.
 */
function validateMustache(
	stmt: hbs.AST.MustacheStatement,
	ctx: AnalysisContext,
): void {
	// Les SubExpressions (helpers imbriqués) ne sont pas supportées pour
	// l'analyse statique — on émet un warning.
	if (stmt.path.type === "SubExpression") {
		addDiagnostic(
			ctx,
			"warning",
			"Sub-expressions are not statically analyzable",
			stmt,
		);
		return;
	}

	resolveExpressionWithDiagnostics(stmt.path, ctx, stmt);
}

/**
 * Extrait le premier argument d'un BlockStatement.
 *
 * Dans l'AST Handlebars, pour `{{#if active}}` :
 * - `stmt.path` → PathExpression("if")    ← le nom du helper
 * - `stmt.params[0]` → PathExpression("active") ← l'argument réel
 *
 * @returns L'expression argument, ou `undefined` si le bloc n'a pas d'argument.
 */
function getBlockArgument(
	stmt: hbs.AST.BlockStatement,
): hbs.AST.Expression | undefined {
	return stmt.params[0] as hbs.AST.Expression | undefined;
}

/**
 * Valide un bloc `{{#helper}}...{{/helper}}`.
 * Supporte : `if`, `unless`, `each`, `with`.
 */
function validateBlock(
	stmt: hbs.AST.BlockStatement,
	ctx: AnalysisContext,
): void {
	const helperName = getBlockHelperName(stmt);

	switch (helperName) {
		case "if":
		case "unless":
			validateIfBlock(stmt, ctx);
			break;

		case "each":
			validateEachBlock(stmt, ctx);
			break;

		case "with":
			validateWithBlock(stmt, ctx);
			break;

		default:
			addDiagnostic(
				ctx,
				"warning",
				`Unknown block helper "{{#${helperName}}}" — cannot analyze statically`,
				stmt,
			);
			// On valide quand même le corps avec le contexte courant (best-effort)
			validateProgram(stmt.program, ctx);
			if (stmt.inverse) validateProgram(stmt.inverse, ctx);
	}
}

/**
 * Valide un bloc `{{#if condition}}...{{else}}...{{/if}}`.
 * La condition doit référencer un chemin valide dans le schema.
 */
function validateIfBlock(
	stmt: hbs.AST.BlockStatement,
	ctx: AnalysisContext,
): void {
	const arg = getBlockArgument(stmt);
	if (arg) {
		// Valider que la condition référence un chemin existant
		resolveExpressionWithDiagnostics(arg, ctx, stmt);
	} else {
		addDiagnostic(
			ctx,
			"error",
			`"{{#${getBlockHelperName(stmt)}}}" requires an argument`,
			stmt,
		);
	}

	// Le contexte ne change pas dans un if/unless — on valide les deux branches
	validateProgram(stmt.program, ctx);
	if (stmt.inverse) validateProgram(stmt.inverse, ctx);
}

/**
 * Valide un bloc `{{#each items}}...{{/each}}`.
 * `items` doit référencer un tableau dans le schema.
 * Le corps du bloc est validé avec le schema des éléments du tableau.
 */
function validateEachBlock(
	stmt: hbs.AST.BlockStatement,
	ctx: AnalysisContext,
): void {
	const arg = getBlockArgument(stmt);
	if (!arg) {
		addDiagnostic(ctx, "error", `"{{#each}}" requires an argument`, stmt);
		validateProgram(stmt.program, { ...ctx, current: {} });
		if (stmt.inverse) validateProgram(stmt.inverse, ctx);
		return;
	}

	const schema = resolveExpressionWithDiagnostics(arg, ctx, stmt);
	if (!schema) {
		// Le chemin n'a pas pu être résolu — on a déjà émis un diagnostic.
		// On valide le corps avec un schema vide (best-effort).
		validateProgram(stmt.program, { ...ctx, current: {} });
		if (stmt.inverse) validateProgram(stmt.inverse, ctx);
		return;
	}

	// Résoudre le schema des éléments du tableau
	const itemSchema = resolveArrayItems(schema, ctx.root);
	if (!itemSchema) {
		addDiagnostic(
			ctx,
			"error",
			`"{{#each}}" expects an array, but resolved schema has type "${schemaTypeLabel(schema)}"`,
			stmt,
		);
		validateProgram(stmt.program, { ...ctx, current: {} });
		if (stmt.inverse) validateProgram(stmt.inverse, ctx);
		return;
	}

	// Valider le corps avec le schema des éléments comme contexte
	validateProgram(stmt.program, { ...ctx, current: itemSchema });

	// La branche inverse ({{else}}) garde le contexte parent
	if (stmt.inverse) validateProgram(stmt.inverse, ctx);
}

/**
 * Valide un bloc `{{#with object}}...{{/with}}`.
 * `object` doit référencer un objet dans le schema.
 * Le corps du bloc est validé avec ce sous-schema comme contexte.
 */
function validateWithBlock(
	stmt: hbs.AST.BlockStatement,
	ctx: AnalysisContext,
): void {
	const arg = getBlockArgument(stmt);
	if (!arg) {
		addDiagnostic(ctx, "error", `"{{#with}}" requires an argument`, stmt);
		validateProgram(stmt.program, { ...ctx, current: {} });
		if (stmt.inverse) validateProgram(stmt.inverse, ctx);
		return;
	}

	const schema = resolveExpressionWithDiagnostics(arg, ctx, stmt);
	if (!schema) {
		validateProgram(stmt.program, { ...ctx, current: {} });
		if (stmt.inverse) validateProgram(stmt.inverse, ctx);
		return;
	}

	// Valider le corps avec le sous-schema comme nouveau contexte
	validateProgram(stmt.program, { ...ctx, current: schema });
	if (stmt.inverse) validateProgram(stmt.inverse, ctx);
}

// ─── Inférence de type ───────────────────────────────────────────────────────
// Ces fonctions déterminent le JSON Schema de sortie du template.

function inferExpressionType(
	expr: hbs.AST.Expression,
	ctx: AnalysisContext,
): JSONSchema7 {
	const schema = resolveExpressionWithDiagnostics(expr, ctx);
	// Si le chemin n'a pas pu être résolu, on retourne un schema vide (unknown).
	// Le diagnostic a déjà été émis par resolveExpressionWithDiagnostics.
	return schema ?? {};
}

/**
 * Infère le type de sortie d'un `Program` (corps d'un template ou d'un bloc).
 *
 * - Si le programme est vide → `{ type: "string" }` (string vide)
 * - Si le programme contient un seul MustacheStatement → type de l'expression
 * - Sinon → `{ type: "string" }` (concaténation)
 */
function inferProgramType(
	program: hbs.AST.Program,
	ctx: AnalysisContext,
): JSONSchema7 {
	const effective = getEffectiveBody(program);

	// Aucun statement significatif → string vide
	if (effective.length === 0) {
		return { type: "string" };
	}

	// ── Cas 1 : une seule expression {{expr}} ──────────────────────────────
	const singleExpr = getEffectivelySingleExpression(program);
	if (singleExpr) {
		return inferExpressionType(singleExpr.path, ctx);
	}

	// ── Cas 2 : un seul bloc {{#if}}, {{#each}}, {{#with}}, … ─────────────
	const singleBlock = getEffectivelySingleBlock(program);
	if (singleBlock) {
		return inferBlockType(singleBlock, ctx);
	}

	// ── Cas 3 : uniquement des ContentStatements (pas d'expressions) ───────
	// Si le texte concaténé (trimé) est un littéral typé (nombre, booléen,
	// null), on infère le type correspondant.
	const allContent = effective.every((s) => s.type === "ContentStatement");
	if (allContent) {
		const text = effective
			.map((s) => (s as hbs.AST.ContentStatement).value)
			.join("")
			.trim();

		if (text === "") return { type: "string" };

		const literalType = detectLiteralType(text);
		if (literalType) return { type: literalType };
	}

	// ── Cas 4 : template mixte (texte + expressions, blocs multiples…) ────
	// On valide pour collecter les diagnostics, le résultat est toujours string.
	validateProgram(program, ctx);
	return { type: "string" };
}

/**
 * Infère le type de sortie d'un bloc `{{#if}}...{{else}}...{{/if}}`.
 * Le résultat est l'union des types des deux branches.
 */
export function inferBlockType(
	stmt: hbs.AST.BlockStatement,
	ctx: AnalysisContext,
): JSONSchema7 {
	const helperName = getBlockHelperName(stmt);

	switch (helperName) {
		case "if":
		case "unless": {
			// Valider la condition (argument du bloc, pas le nom du helper)
			const arg = getBlockArgument(stmt);
			if (arg) {
				resolveExpressionWithDiagnostics(arg, ctx, stmt);
			}

			const thenType = inferProgramType(stmt.program, ctx);

			if (stmt.inverse) {
				const elseType = inferProgramType(stmt.inverse, ctx);
				// Union des deux branches
				const thenJson = JSON.stringify(thenType);
				const elseJson = JSON.stringify(elseType);
				if (thenJson === elseJson) return thenType;
				return simplifySchema({ oneOf: [thenType, elseType] });
			}

			// Pas de branche else → le résultat peut être undefined (string vide
			// en Handlebars, mais conceptuellement c'est optionnel).
			return thenType;
		}

		case "each": {
			// Valider et résoudre le schema de la collection (argument du bloc)
			const arg = getBlockArgument(stmt);
			if (arg) {
				const collectionSchema = resolveExpressionWithDiagnostics(
					arg,
					ctx,
					stmt,
				);
				if (collectionSchema) {
					const itemSchema = resolveArrayItems(collectionSchema, ctx.root);
					if (itemSchema) {
						// Valider le corps avec le contexte des éléments
						validateProgram(stmt.program, { ...ctx, current: itemSchema });
					} else {
						// La cible n'est pas un tableau — même diagnostic que validateEachBlock
						addDiagnostic(
							ctx,
							"error",
							`"{{#each}}" expects an array, but resolved schema has type "${schemaTypeLabel(collectionSchema)}"`,
							stmt,
						);
					}
				}
			}
			// Un each concatène les rendus → toujours string
			return { type: "string" };
		}

		case "with": {
			const arg = getBlockArgument(stmt);
			if (arg) {
				const innerSchema = resolveExpressionWithDiagnostics(arg, ctx, stmt);
				if (innerSchema) {
					return inferProgramType(stmt.program, {
						...ctx,
						current: innerSchema,
					});
				}
			}
			return inferProgramType(stmt.program, { ...ctx, current: {} });
		}

		default: {
			// Helper inconnu — on ne peut rien inférer
			validateProgram(stmt.program, ctx);
			if (stmt.inverse) validateProgram(stmt.inverse, ctx);
			return { type: "string" };
		}
	}
}

// ─── Résolution d'expressions ────────────────────────────────────────────────

/**
 * Résout une expression AST en un sous-schema, en émettant un diagnostic
 * si le chemin n'est pas résolvable.
 *
 * Gère la syntaxe `{{key:N}}` :
 * - Si l'expression a un identifiant N → résolution dans `identifierSchemas[N]`
 * - Si l'identifiant N n'a pas de schema associé → erreur
 * - Si pas d'identifiant → résolution dans `ctx.current` (comportement standard)
 *
 * @returns Le sous-schema résolu, ou `undefined` si le chemin est invalide.
 */
function resolveExpressionWithDiagnostics(
	expr: hbs.AST.Expression,
	ctx: AnalysisContext,
	/** Nœud AST parent (pour la localisation du diagnostic) */
	parentNode?: hbs.AST.Node,
): JSONSchema7 | undefined {
	// Gestion de `this` / `.` → retourne le contexte courant
	if (isThisExpression(expr)) {
		return ctx.current;
	}

	const segments = extractPathSegments(expr);
	if (segments.length === 0) {
		// Expression qui n'est pas un PathExpression (ex: literal, SubExpression)
		if (expr.type === "StringLiteral") return { type: "string" };
		if (expr.type === "NumberLiteral") return { type: "number" };
		if (expr.type === "BooleanLiteral") return { type: "boolean" };
		if (expr.type === "NullLiteral") return { type: "null" };
		if (expr.type === "UndefinedLiteral") return {};

		addDiagnostic(
			ctx,
			"warning",
			`Expression of type "${expr.type}" cannot be statically analyzed`,
			parentNode ?? expr,
		);
		return undefined;
	}

	// ── Extraction de l'identifiant ────────────────────────────────────────
	const { cleanSegments, identifier } = extractExpressionIdentifier(segments);

	if (identifier !== null) {
		// L'expression utilise la syntaxe {{key:N}} — résoudre depuis
		// le schema de l'identifiant N.
		return resolveWithIdentifier(
			cleanSegments,
			identifier,
			ctx,
			parentNode ?? expr,
		);
	}

	// ── Résolution standard (pas d'identifiant) ────────────────────────────
	const resolved = resolveSchemaPath(ctx.current, cleanSegments);
	if (resolved === undefined) {
		const fullPath = cleanSegments.join(".");
		addDiagnostic(
			ctx,
			"error",
			`Property "${fullPath}" does not exist in the context schema`,
			parentNode ?? expr,
		);
		return undefined;
	}

	return resolved;
}

/**
 * Résout une expression avec identifiant `{{key:N}}` en cherchant dans
 * le schema associé à l'identifiant N.
 *
 * Émet un diagnostic d'erreur si :
 * - Aucun `identifierSchemas` n'a été fourni
 * - L'identifiant N n'a pas de schema associé
 * - La propriété n'existe pas dans le schema de l'identifiant
 */
function resolveWithIdentifier(
	cleanSegments: string[],
	identifier: number,
	ctx: AnalysisContext,
	node: hbs.AST.Node,
): JSONSchema7 | undefined {
	const fullPath = cleanSegments.join(".");

	// Pas d'identifierSchemas fourni du tout
	if (!ctx.identifierSchemas) {
		addDiagnostic(
			ctx,
			"error",
			`Property "${fullPath}:${identifier}" uses an identifier but no identifier schemas were provided`,
			node,
		);
		return undefined;
	}

	// L'identifiant n'existe pas dans les schemas fournis
	const idSchema = ctx.identifierSchemas[identifier];
	if (!idSchema) {
		addDiagnostic(
			ctx,
			"error",
			`Property "${fullPath}:${identifier}" references identifier ${identifier} but no schema exists for this identifier`,
			node,
		);
		return undefined;
	}

	// Résoudre le chemin dans le schema de l'identifiant
	const resolved = resolveSchemaPath(idSchema, cleanSegments);
	if (resolved === undefined) {
		addDiagnostic(
			ctx,
			"error",
			`Property "${fullPath}" does not exist in the schema for identifier ${identifier}`,
			node,
		);
		return undefined;
	}

	return resolved;
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/**
 * Récupère le nom du helper d'un BlockStatement (ex: "if", "each", "with").
 */
function getBlockHelperName(stmt: hbs.AST.BlockStatement): string {
	if (stmt.path.type === "PathExpression") {
		return (stmt.path as hbs.AST.PathExpression).original;
	}
	return "";
}

/**
 * Ajoute un diagnostic au contexte d'analyse.
 */
function addDiagnostic(
	ctx: AnalysisContext,
	severity: "error" | "warning",
	message: string,
	node?: hbs.AST.Node,
): void {
	const diagnostic: TemplateDiagnostic = { severity, message };

	// Extraire la position si disponible dans le nœud AST
	if (node && "loc" in node && node.loc) {
		diagnostic.loc = {
			start: { line: node.loc.start.line, column: node.loc.start.column },
			end: { line: node.loc.end.line, column: node.loc.end.column },
		};
	}

	ctx.diagnostics.push(diagnostic);
}

/**
 * Retourne un label lisible du type d'un schema (pour les messages d'erreur).
 */
function schemaTypeLabel(schema: JSONSchema7): string {
	if (schema.type) {
		return Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
	}
	if (schema.oneOf) return "oneOf(...)";
	if (schema.anyOf) return "anyOf(...)";
	if (schema.allOf) return "allOf(...)";
	if (schema.enum) return "enum";
	return "unknown";
}
