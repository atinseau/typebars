import {
	createMissingArgumentMessage,
	createPropertyNotFoundMessage,
	createTypeMismatchMessage,
	createUnanalyzableMessage,
	createUnknownHelperMessage,
} from "./errors.ts";
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
	DiagnosticCode,
	DiagnosticDetails,
	HelperDefinition,
	JSONSchema7,
	TemplateDiagnostic,
} from "./types.ts";
import {
	deepEqual,
	extractSourceSnippet,
	getSchemaPropertyNames,
} from "./utils.ts";

// ─── Static Analyzer ─────────────────────────────────────────────────────────
// Analyse statique d'un template Handlebars par rapport à un JSON Schema v7
// décrivant le contexte disponible.
//
// Architecture fusionnée (v2) :
// Un seul parcours de l'AST effectue simultanément la **validation** et
// l'**inférence du type de retour**. Cela élimine la duplication entre les
// anciennes fonctions `validate*` et `infer*`, et améliore la performance
// en évitant un double parcours.
//
// Contexte :
// Le contexte d'analyse utilise un pattern **save/restore** au lieu de
// créer de nouveaux objets à chaque récursion (`{ ...ctx, current: X }`).
// Cela réduit la pression sur le GC pour les templates profondément imbriqués.
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
	/** Schema du contexte courant (change avec #each, #with) — muté via save/restore */
	current: JSONSchema7;
	/** Accumulateur de diagnostics */
	diagnostics: TemplateDiagnostic[];
	/** Template source complet (pour extraire les snippets d'erreur) */
	template: string;
	/** Schemas par identifiant de template (pour la syntaxe {{key:N}}) */
	identifierSchemas?: Record<number, JSONSchema7>;
	/** Helpers custom enregistrés (pour l'analyse statique) */
	helpers?: Map<string, HelperDefinition>;
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Analyse statiquement un template par rapport à un JSON Schema v7 décrivant
 * le contexte disponible.
 *
 * Version backward-compatible — parse le template en interne.
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
	return analyzeFromAst(ast, template, inputSchema, { identifierSchemas });
}

/**
 * Analyse statiquement un template à partir d'un AST déjà parsé.
 *
 * C'est la fonction interne utilisée par `TemplateEngine.compile()` et
 * `CompiledTemplate.analyze()` pour éviter un re-parsing coûteux.
 *
 * @param ast               - L'AST Handlebars déjà parsé
 * @param template          - Le template source (pour les snippets d'erreur)
 * @param inputSchema       - JSON Schema v7 décrivant les variables disponibles
 * @param options           - Options supplémentaires
 * @returns Un `AnalysisResult`
 */
export function analyzeFromAst(
	ast: hbs.AST.Program,
	template: string,
	inputSchema: JSONSchema7,
	options?: {
		identifierSchemas?: Record<number, JSONSchema7>;
		helpers?: Map<string, HelperDefinition>;
	},
): AnalysisResult {
	const ctx: AnalysisContext = {
		root: inputSchema,
		current: inputSchema,
		diagnostics: [],
		template,
		identifierSchemas: options?.identifierSchemas,
		helpers: options?.helpers,
	};

	// Parcours unique : inférence du type + validation en un seul pass.
	const outputSchema = inferProgramType(ast, ctx);

	const hasErrors = ctx.diagnostics.some((d) => d.severity === "error");

	return {
		valid: !hasErrors,
		diagnostics: ctx.diagnostics,
		outputSchema: simplifySchema(outputSchema),
	};
}

// ─── Parcours unifié de l'AST ────────────────────────────────────────────────
// Un seul ensemble de fonctions gère à la fois la validation (émission de
// diagnostics) et l'inférence de type (retour d'un JSONSchema7).
//
// Fonctions principales :
// - `inferProgramType`   — point d'entrée pour un Program (corps de template ou bloc)
// - `processStatement`   — dispatche un statement (validation side-effect)
// - `processMustache`    — gère un MustacheStatement (expression ou helper inline)
// - `inferBlockType`     — gère un BlockStatement (if, each, with, custom…)

/**
 * Dispatche le traitement d'un statement individuel.
 *
 * Appelé par `inferProgramType` dans le cas "template mixte" pour valider
 * chaque statement tout en ignorant le type retourné (le résultat est
 * toujours `string` pour un template mixte).
 *
 * @returns Le schema inféré pour ce statement, ou `undefined` pour les
 *          statements sans sémantique (ContentStatement, CommentStatement).
 */
function processStatement(
	stmt: hbs.AST.Statement,
	ctx: AnalysisContext,
): JSONSchema7 | undefined {
	switch (stmt.type) {
		case "ContentStatement":
		case "CommentStatement":
			// Texte statique ou commentaire — rien à valider, pas de type à inférer
			return undefined;

		case "MustacheStatement":
			return processMustache(stmt as hbs.AST.MustacheStatement, ctx);

		case "BlockStatement":
			return inferBlockType(stmt as hbs.AST.BlockStatement, ctx);

		default:
			// Nœud AST non reconnu — on émet un warning plutôt qu'une erreur
			// pour ne pas bloquer sur des extensions futures de Handlebars.
			addDiagnostic(
				ctx,
				"UNANALYZABLE",
				"warning",
				`Unsupported AST node type: "${stmt.type}"`,
				stmt,
			);
			return undefined;
	}
}

/**
 * Traite un MustacheStatement `{{expression}}` ou `{{helper arg}}`.
 *
 * Distingue deux cas :
 * 1. **Expression simple** (`{{name}}`, `{{user.age}}`) — résolution dans le schema
 * 2. **Helper inline** (`{{uppercase name}}`) — params > 0 ou hash présent
 *
 * @returns Le schema inféré pour cette expression
 */
function processMustache(
	stmt: hbs.AST.MustacheStatement,
	ctx: AnalysisContext,
): JSONSchema7 {
	// Sub-expressions (helpers imbriqués) ne sont pas supportées pour
	// l'analyse statique — on émet un warning.
	if (stmt.path.type === "SubExpression") {
		addDiagnostic(
			ctx,
			"UNANALYZABLE",
			"warning",
			"Sub-expressions are not statically analyzable",
			stmt,
		);
		return {};
	}

	// ── Détection des helpers inline ─────────────────────────────────────────
	// Si le MustacheStatement a des paramètres ou un hash, c'est un appel
	// de helper (ex: `{{uppercase name}}`), pas une simple expression.
	if (stmt.params.length > 0 || stmt.hash) {
		const helperName = getExpressionName(stmt.path);

		// Vérifier si le helper est enregistré
		const helper = ctx.helpers?.get(helperName);
		if (helper) {
			// Valider les paramètres
			for (const param of stmt.params) {
				resolveExpressionWithDiagnostics(
					param as hbs.AST.Expression,
					ctx,
					stmt,
				);
			}
			return helper.returnType ?? { type: "string" };
		}

		// Helper inline inconnu — warning
		addDiagnostic(
			ctx,
			"UNKNOWN_HELPER",
			"warning",
			`Unknown inline helper "${helperName}" — cannot analyze statically`,
			stmt,
			{ helperName },
		);
		return { type: "string" };
	}

	// ── Expression simple ────────────────────────────────────────────────────
	return resolveExpressionWithDiagnostics(stmt.path, ctx, stmt) ?? {};
}

/**
 * Infère le type de sortie d'un `Program` (corps d'un template ou d'un bloc).
 *
 * Gère 4 cas, du plus spécifique au plus général :
 *
 * 1. **Expression unique** `{{expr}}` → type de l'expression
 * 2. **Bloc unique** `{{#if}}…{{/if}}` → type du bloc
 * 3. **Contenu textuel pur** → détection de littéral (number, boolean, null)
 * 4. **Template mixte** → toujours `string` (concaténation)
 *
 * La validation est effectuée en même temps que l'inférence : chaque
 * expression et bloc est validé lors de son traitement.
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
		return processMustache(singleExpr, ctx);
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
	// On parcourt tous les statements pour valider (side-effects : diagnostics).
	// Le résultat est toujours string (concaténation).
	for (const stmt of program.body) {
		processStatement(stmt, ctx);
	}
	return { type: "string" };
}

/**
 * Infère le type de sortie d'un BlockStatement et valide son contenu.
 *
 * Supporte les helpers built-in (`if`, `unless`, `each`, `with`) et les
 * helpers custom enregistrés via `TemplateEngine.registerHelper()`.
 *
 * Utilise le pattern **save/restore** pour le contexte : au lieu de créer
 * un nouvel objet `{ ...ctx, current: X }` à chaque récursion, on sauvegarde
 * `ctx.current`, on le mute, on traite le corps, puis on restaure. Cela
 * réduit la pression sur le GC pour les templates profondément imbriqués.
 */
function inferBlockType(
	stmt: hbs.AST.BlockStatement,
	ctx: AnalysisContext,
): JSONSchema7 {
	const helperName = getBlockHelperName(stmt);

	switch (helperName) {
		// ── if / unless ──────────────────────────────────────────────────────
		case "if":
		case "unless": {
			const arg = getBlockArgument(stmt);
			if (arg) {
				resolveExpressionWithDiagnostics(arg, ctx, stmt);
			} else {
				addDiagnostic(
					ctx,
					"MISSING_ARGUMENT",
					"error",
					createMissingArgumentMessage(helperName),
					stmt,
					{ helperName },
				);
			}

			// Inférer le type de la branche "then"
			const thenType = inferProgramType(stmt.program, ctx);

			if (stmt.inverse) {
				const elseType = inferProgramType(stmt.inverse, ctx);
				// Si les deux branches ont le même type → type unique
				if (deepEqual(thenType, elseType)) return thenType;
				// Sinon → union des deux types
				return simplifySchema({ oneOf: [thenType, elseType] });
			}

			// Pas de branche else → le résultat est le type de la branche then
			// (conceptuellement optionnel, mais Handlebars retourne "" pour falsy)
			return thenType;
		}

		// ── each ─────────────────────────────────────────────────────────────
		case "each": {
			const arg = getBlockArgument(stmt);
			if (!arg) {
				addDiagnostic(
					ctx,
					"MISSING_ARGUMENT",
					"error",
					createMissingArgumentMessage("each"),
					stmt,
					{ helperName: "each" },
				);
				// Valider le corps avec un contexte vide (best-effort)
				const saved = ctx.current;
				ctx.current = {};
				inferProgramType(stmt.program, ctx);
				ctx.current = saved;
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return { type: "string" };
			}

			const collectionSchema = resolveExpressionWithDiagnostics(arg, ctx, stmt);
			if (!collectionSchema) {
				// Le chemin n'a pas pu être résolu — diagnostic déjà émis.
				const saved = ctx.current;
				ctx.current = {};
				inferProgramType(stmt.program, ctx);
				ctx.current = saved;
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return { type: "string" };
			}

			// Résoudre le schema des éléments du tableau
			const itemSchema = resolveArrayItems(collectionSchema, ctx.root);
			if (!itemSchema) {
				addDiagnostic(
					ctx,
					"TYPE_MISMATCH",
					"error",
					createTypeMismatchMessage(
						"each",
						"an array",
						schemaTypeLabel(collectionSchema),
					),
					stmt,
					{
						helperName: "each",
						expected: "array",
						actual: schemaTypeLabel(collectionSchema),
					},
				);
				// Valider le corps avec un contexte vide (best-effort)
				const saved = ctx.current;
				ctx.current = {};
				inferProgramType(stmt.program, ctx);
				ctx.current = saved;
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return { type: "string" };
			}

			// Valider le corps avec le schema des éléments comme contexte
			const saved = ctx.current;
			ctx.current = itemSchema;
			inferProgramType(stmt.program, ctx);
			ctx.current = saved;

			// La branche inverse ({{else}}) garde le contexte parent
			if (stmt.inverse) inferProgramType(stmt.inverse, ctx);

			// Un each concatène les rendus → toujours string
			return { type: "string" };
		}

		// ── with ─────────────────────────────────────────────────────────────
		case "with": {
			const arg = getBlockArgument(stmt);
			if (!arg) {
				addDiagnostic(
					ctx,
					"MISSING_ARGUMENT",
					"error",
					createMissingArgumentMessage("with"),
					stmt,
					{ helperName: "with" },
				);
				// Valider le corps avec un contexte vide
				const saved = ctx.current;
				ctx.current = {};
				const result = inferProgramType(stmt.program, ctx);
				ctx.current = saved;
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return result;
			}

			const innerSchema = resolveExpressionWithDiagnostics(arg, ctx, stmt);

			const saved = ctx.current;
			ctx.current = innerSchema ?? {};
			const result = inferProgramType(stmt.program, ctx);
			ctx.current = saved;

			// La branche inverse garde le contexte parent
			if (stmt.inverse) inferProgramType(stmt.inverse, ctx);

			return result;
		}

		// ── Helper custom ou inconnu ─────────────────────────────────────────
		default: {
			const helper = ctx.helpers?.get(helperName);
			if (helper) {
				// Helper custom enregistré — valider les paramètres
				for (const param of stmt.params) {
					resolveExpressionWithDiagnostics(
						param as hbs.AST.Expression,
						ctx,
						stmt,
					);
				}
				// Valider le corps avec le contexte courant
				inferProgramType(stmt.program, ctx);
				if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
				return helper.returnType ?? { type: "string" };
			}

			// Helper inconnu — warning
			addDiagnostic(
				ctx,
				"UNKNOWN_HELPER",
				"warning",
				createUnknownHelperMessage(helperName),
				stmt,
				{ helperName },
			);
			// Valider quand même le corps avec le contexte courant (best-effort)
			inferProgramType(stmt.program, ctx);
			if (stmt.inverse) inferProgramType(stmt.inverse, ctx);
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
			"UNANALYZABLE",
			"warning",
			createUnanalyzableMessage(expr.type),
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
		const availableProperties = getSchemaPropertyNames(ctx.current);
		addDiagnostic(
			ctx,
			"UNKNOWN_PROPERTY",
			"error",
			createPropertyNotFoundMessage(fullPath, availableProperties),
			parentNode ?? expr,
			{ path: fullPath, availableProperties },
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
			"MISSING_IDENTIFIER_SCHEMAS",
			"error",
			`Property "${fullPath}:${identifier}" uses an identifier but no identifier schemas were provided`,
			node,
			{ path: `${fullPath}:${identifier}`, identifier },
		);
		return undefined;
	}

	// L'identifiant n'existe pas dans les schemas fournis
	const idSchema = ctx.identifierSchemas[identifier];
	if (!idSchema) {
		addDiagnostic(
			ctx,
			"UNKNOWN_IDENTIFIER",
			"error",
			`Property "${fullPath}:${identifier}" references identifier ${identifier} but no schema exists for this identifier`,
			node,
			{ path: `${fullPath}:${identifier}`, identifier },
		);
		return undefined;
	}

	// Résoudre le chemin dans le schema de l'identifiant
	const resolved = resolveSchemaPath(idSchema, cleanSegments);
	if (resolved === undefined) {
		const availableProperties = getSchemaPropertyNames(idSchema);
		addDiagnostic(
			ctx,
			"IDENTIFIER_PROPERTY_NOT_FOUND",
			"error",
			`Property "${fullPath}" does not exist in the schema for identifier ${identifier}`,
			node,
			{
				path: fullPath,
				identifier,
				availableProperties,
			},
		);
		return undefined;
	}

	return resolved;
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

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
 * Récupère le nom du helper d'un BlockStatement (ex: "if", "each", "with").
 */
function getBlockHelperName(stmt: hbs.AST.BlockStatement): string {
	if (stmt.path.type === "PathExpression") {
		return (stmt.path as hbs.AST.PathExpression).original;
	}
	return "";
}

/**
 * Récupère le nom d'une expression (premier segment du PathExpression).
 * Utilisé pour identifier les helpers inline.
 */
function getExpressionName(expr: hbs.AST.Expression): string {
	if (expr.type === "PathExpression") {
		return (expr as hbs.AST.PathExpression).original;
	}
	return "";
}

/**
 * Ajoute un diagnostic enrichi au contexte d'analyse.
 *
 * Chaque diagnostic inclut :
 * - Un `code` machine-readable pour le frontend
 * - Un `message` humain décrivant le problème
 * - Un `source` snippet du template (si la position est disponible)
 * - Des `details` structurés pour le debugging
 */
function addDiagnostic(
	ctx: AnalysisContext,
	code: DiagnosticCode,
	severity: "error" | "warning",
	message: string,
	node?: hbs.AST.Node,
	details?: DiagnosticDetails,
): void {
	const diagnostic: TemplateDiagnostic = { severity, code, message };

	// Extraire la position et le snippet source si disponible
	if (node && "loc" in node && node.loc) {
		diagnostic.loc = {
			start: { line: node.loc.start.line, column: node.loc.start.column },
			end: { line: node.loc.end.line, column: node.loc.end.column },
		};
		// Extraire le fragment de template autour de l'erreur
		diagnostic.source = extractSourceSnippet(ctx.template, diagnostic.loc);
	}

	if (details) {
		diagnostic.details = details;
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

// ─── Export pour usage interne ────────────────────────────────────────────────
// `inferBlockType` est exporté pour permettre des tests unitaires ciblés
// sur l'inférence de type des blocs.
export { inferBlockType };
