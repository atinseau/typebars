import type { HelperDefinition } from "../types.ts";

// ─── MathHelpers ─────────────────────────────────────────────────────────────
// Classe regroupant tous les helpers mathématiques pour le moteur de template.
//
// Fournit deux types de helpers :
//
// 1. **Helpers nommés** — un helper par opération (`add`, `subtract`, `divide`, …)
//    Usage : `{ { add a b } } `, `{ { abs value } } `, `{ { round value 2 } } `
//
// 2. **Helper générique `math`** — un seul helper avec l'opérateur en paramètre
//    Usage : `{ { math a "+" b } } `, `{ { math a "/" b } } `, `{ { math a "**" b } } `
//
// ─── Enregistrement ──────────────────────────────────────────────────────────
// Les MathHelpers sont pré-enregistrés automatiquement par le constructeur
// de `Typebars`. Il est aussi possible de les enregistrer manuellement
// sur n'importe quel objet implémentant `HelperRegistry` :
//
//   MathHelpers.register(engine);   // enregistre tous les helpers
//   MathHelpers.unregister(engine); // les supprime tous
//
// ─── Opérateurs supportés (helper `math`) ────────────────────────────────────
//   +   Addition
//   -   Subtraction
//   *   Multiplication
//   /   Division
//   %   Modulo
//   **  Exponentiation

// ─── Types ───────────────────────────────────────────────────────────────────

/** Interface minimale pour l'enregistrement — évite le couplage avec Typebars */
interface HelperRegistry {
	registerHelper(name: string, definition: HelperDefinition): unknown;
	unregisterHelper(name: string): unknown;
}

/** Opérateurs supportés par le helper générique `math` */
type MathOperator = "+" | "-" | "*" | "/" | "%" | "**";

const SUPPORTED_OPERATORS = new Set<string>(["+", "-", "*", "/", "%", "**"]);

// ─── Utilitaires internes ────────────────────────────────────────────────────

/**
 * Convertit une valeur inconnue en nombre. Retourne `0` si la conversion
 * échoue (string non numérique, objet, etc.).
 */
function toNumber(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const n = Number(value);
		return Number.isNaN(n) ? 0 : n;
	}
	return 0;
}

/**
 * Applique un opérateur binaire sur deux opérandes.
 */
function applyOperator(a: number, op: MathOperator, b: number): number {
	switch (op) {
		case "+":
			return a + b;
		case "-":
			return a - b;
		case "*":
			return a * b;
		case "/":
			return b === 0 ? Infinity : a / b;
		case "%":
			return b === 0 ? NaN : a % b;
		case "**":
			return a ** b;
	}
}

// ─── Classe principale ──────────────────────────────────────────────────────

export class MathHelpers {
	// ─── Noms de tous les helpers enregistrés ─────────────────────────────
	// Utilisé par `register()` et `unregister()` pour itérer.
	private static readonly HELPER_NAMES: readonly string[] = [
		// Opérateurs binaires
		"add",
		"subtract",
		"sub",
		"multiply",
		"mul",
		"divide",
		"div",
		"modulo",
		"mod",
		"pow",

		// Fonctions unaires
		"abs",
		"ceil",
		"floor",
		"round",
		"sqrt",

		// Min / Max (binaires)
		"min",
		"max",

		// Helper générique
		"math",
	];

	/** Set dérivé de `HELPER_NAMES` pour un lookup O(1) dans `isMathHelper()` */
	private static readonly HELPER_NAMES_SET: ReadonlySet<string> = new Set(
		MathHelpers.HELPER_NAMES,
	);

	// ─── Définitions des helpers ─────────────────────────────────────────

	/** Retourne toutes les définitions sous forme de `Map<name, HelperDefinition>` */
	static getDefinitions(): Map<string, HelperDefinition> {
		const defs = new Map<string, HelperDefinition>();

		MathHelpers.registerBinaryOperators(defs);
		MathHelpers.registerUnaryFunctions(defs);
		MathHelpers.registerMinMax(defs);
		MathHelpers.registerGenericMath(defs);

		return defs;
	}

	// ── Opérateurs binaires ──────────────────────────────────────────

	/** Enregistre add, subtract/sub, multiply/mul, divide/div, modulo/mod, pow */
	private static registerBinaryOperators(
		defs: Map<string, HelperDefinition>,
	): void {
		// add — Addition : {{ add a b }}
		const addDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => toNumber(a) + toNumber(b),
			params: [
				{ name: "a", type: { type: "number" }, description: "First operand" },
				{ name: "b", type: { type: "number" }, description: "Second operand" },
			],
			returnType: { type: "number" },
			description: "Adds two numbers: {{ add a b }}",
		};
		defs.set("add", addDef);

		// subtract / sub — Soustraction : {{ subtract a b }} ou {{ sub a b }}
		const subtractDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => toNumber(a) - toNumber(b),
			params: [
				{
					name: "a",
					type: { type: "number" },
					description: "Value to subtract from",
				},
				{
					name: "b",
					type: { type: "number" },
					description: "Value to subtract",
				},
			],
			returnType: { type: "number" },
			description: "Subtracts b from a: {{ subtract a b }}",
		};
		defs.set("subtract", subtractDef);
		defs.set("sub", subtractDef);

		// multiply / mul — Multiplication : {{ multiply a b }} ou {{ mul a b }}
		const multiplyDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => toNumber(a) * toNumber(b),
			params: [
				{ name: "a", type: { type: "number" }, description: "First factor" },
				{ name: "b", type: { type: "number" }, description: "Second factor" },
			],
			returnType: { type: "number" },
			description: "Multiplies two numbers: {{ multiply a b }}",
		};
		defs.set("multiply", multiplyDef);
		defs.set("mul", multiplyDef);

		// divide / div — Division : {{ divide a b }} ou {{ div a b }}
		const divideDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => {
				const divisor = toNumber(b);
				return divisor === 0 ? Infinity : toNumber(a) / divisor;
			},
			params: [
				{ name: "a", type: { type: "number" }, description: "Dividend" },
				{ name: "b", type: { type: "number" }, description: "Divisor" },
			],
			returnType: { type: "number" },
			description:
				"Divides a by b: {{ divide a b }}. Returns Infinity if b is 0.",
		};
		defs.set("divide", divideDef);
		defs.set("div", divideDef);

		// modulo / mod — Modulo : {{ modulo a b }} ou {{ mod a b }}
		const moduloDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => {
				const divisor = toNumber(b);
				return divisor === 0 ? NaN : toNumber(a) % divisor;
			},
			params: [
				{ name: "a", type: { type: "number" }, description: "Dividend" },
				{ name: "b", type: { type: "number" }, description: "Divisor" },
			],
			returnType: { type: "number" },
			description: "Returns the remainder of a divided by b: {{ modulo a b }}",
		};
		defs.set("modulo", moduloDef);
		defs.set("mod", moduloDef);

		// pow — Exponentiation : {{ pow base exponent }}
		defs.set("pow", {
			fn: (base: unknown, exponent: unknown) =>
				toNumber(base) ** toNumber(exponent),
			params: [
				{ name: "base", type: { type: "number" }, description: "The base" },
				{
					name: "exponent",
					type: { type: "number" },
					description: "The exponent",
				},
			],
			returnType: { type: "number" },
			description:
				"Raises base to the power of exponent: {{ pow base exponent }}",
		});
	}

	// ── Fonctions unaires ────────────────────────────────────────────

	/** Enregistre abs, ceil, floor, round, sqrt */
	private static registerUnaryFunctions(
		defs: Map<string, HelperDefinition>,
	): void {
		// abs — Valeur absolue : {{ abs value }}
		defs.set("abs", {
			fn: (value: unknown) => Math.abs(toNumber(value)),
			params: [
				{ name: "value", type: { type: "number" }, description: "The number" },
			],
			returnType: { type: "number" },
			description: "Returns the absolute value: {{ abs value }}",
		});

		// ceil — Arrondi supérieur : {{ ceil value }}
		defs.set("ceil", {
			fn: (value: unknown) => Math.ceil(toNumber(value)),
			params: [
				{
					name: "value",
					type: { type: "number" },
					description: "The number to round up",
				},
			],
			returnType: { type: "number" },
			description: "Rounds up to the nearest integer: {{ ceil value }}",
		});

		// floor — Arrondi inférieur : {{ floor value }}
		defs.set("floor", {
			fn: (value: unknown) => Math.floor(toNumber(value)),
			params: [
				{
					name: "value",
					type: { type: "number" },
					description: "The number to round down",
				},
			],
			returnType: { type: "number" },
			description: "Rounds down to the nearest integer: {{ floor value }}",
		});

		// round — Arrondi : {{ round value }} ou {{ round value precision }}
		// Avec précision : {{ round 3.14159 2 }} → 3.14
		defs.set("round", {
			fn: (value: unknown, precision: unknown) => {
				const n = toNumber(value);
				// Si precision est un objet Handlebars options (pas un nombre),
				// c'est que le second paramètre n'a pas été fourni.
				if (
					precision === undefined ||
					precision === null ||
					typeof precision === "object"
				) {
					return Math.round(n);
				}
				const p = toNumber(precision);
				const factor = 10 ** p;
				return Math.round(n * factor) / factor;
			},
			params: [
				{
					name: "value",
					type: { type: "number" },
					description: "The number to round",
				},
				{
					name: "precision",
					type: { type: "number" },
					description: "Number of decimal places (default: 0)",
					optional: true,
				},
			],
			returnType: { type: "number" },
			description:
				"Rounds to the nearest integer or to a given precision: {{ round value }} or {{ round value 2 }}",
		});

		// sqrt — Racine carrée : {{ sqrt value }}
		defs.set("sqrt", {
			fn: (value: unknown) => Math.sqrt(toNumber(value)),
			params: [
				{ name: "value", type: { type: "number" }, description: "The number" },
			],
			returnType: { type: "number" },
			description: "Returns the square root: {{ sqrt value }}",
		});
	}

	// ── Min / Max ────────────────────────────────────────────────────

	/** Enregistre min et max */
	private static registerMinMax(defs: Map<string, HelperDefinition>): void {
		// min — Minimum : {{ min a b }}
		defs.set("min", {
			fn: (a: unknown, b: unknown) => Math.min(toNumber(a), toNumber(b)),
			params: [
				{ name: "a", type: { type: "number" }, description: "First number" },
				{ name: "b", type: { type: "number" }, description: "Second number" },
			],
			returnType: { type: "number" },
			description: "Returns the smaller of two numbers: {{ min a b }}",
		});

		// max — Maximum : {{ max a b }}
		defs.set("max", {
			fn: (a: unknown, b: unknown) => Math.max(toNumber(a), toNumber(b)),
			params: [
				{ name: "a", type: { type: "number" }, description: "First number" },
				{ name: "b", type: { type: "number" }, description: "Second number" },
			],
			returnType: { type: "number" },
			description: "Returns the larger of two numbers: {{ max a b }}",
		});
	}

	// ── Helper générique ─────────────────────────────────────────────

	/** Enregistre le helper générique `math` avec opérateur en paramètre */
	private static registerGenericMath(
		defs: Map<string, HelperDefinition>,
	): void {
		// Usage : {{ math a "+" b }}, {{ math a "/" b }}, {{ math a "**" b }}
		defs.set("math", {
			fn: (a: unknown, operator: unknown, b: unknown) => {
				const op = String(operator);
				if (!SUPPORTED_OPERATORS.has(op)) {
					throw new Error(
						`[math helper] Unknown operator "${op}". ` +
							`Supported: ${[...SUPPORTED_OPERATORS].join(", ")} `,
					);
				}
				return applyOperator(toNumber(a), op as MathOperator, toNumber(b));
			},
			params: [
				{ name: "a", type: { type: "number" }, description: "Left operand" },
				{
					name: "operator",
					type: { type: "string", enum: ["+", "-", "*", "/", "%", "**"] },
					description: 'Arithmetic operator: "+", "-", "*", "/", "%", "**"',
				},
				{ name: "b", type: { type: "number" }, description: "Right operand" },
			],
			returnType: { type: "number" },
			description:
				'Generic math helper with operator as parameter: {{ math a "+" b }}, {{ math a "/" b }}. ' +
				"Supported operators: +, -, *, /, %, **",
		});
	}

	// ─── Enregistrement / Désenregistrement ──────────────────────────────

	/**
	 * Enregistre tous les helpers mathématiques sur un `Typebars`
	 * (ou tout objet implémentant `HelperRegistry`).
	 *
	 * **Note :** les MathHelpers sont pré-enregistrés automatiquement par
	 * le constructeur de `Typebars`. Cette méthode n'est utile que
	 * si vous avez appelé `unregister()` et souhaitez les ré-activer,
	 * ou si vous enregistrez sur un registre custom.
	 *
	 * @param registry - L'engine ou le registre cible
	 *
	 * @example
	 * ```
	 * const engine = new Typebars();
	 * // Les math helpers sont déjà disponibles !
	 * engine.analyzeAndExecute("{{ divide total count }}", schema, data);
	 * engine.analyzeAndExecute("{{ math price '*' quantity }}", schema, data);
	 * ```
	 */
	static register(registry: HelperRegistry): void {
		const defs = MathHelpers.getDefinitions();
		for (const [name, def] of defs) {
			registry.registerHelper(name, def);
		}
	}

	/**
	 * Supprime tous les helpers mathématiques du registre.
	 *
	 * @param registry - L'engine ou le registre cible
	 */
	static unregister(registry: HelperRegistry): void {
		for (const name of MathHelpers.HELPER_NAMES) {
			registry.unregisterHelper(name);
		}
	}

	/**
	 * Retourne la liste des noms de tous les helpers mathématiques.
	 * Utile pour vérifier si un helper donné fait partie du pack math.
	 */
	static getHelperNames(): readonly string[] {
		return MathHelpers.HELPER_NAMES;
	}

	/**
	 * Vérifie si un nom de helper fait partie du pack mathématique.
	 *
	 * @param name - Le nom du helper à vérifier
	 */
	static isMathHelper(name: string): boolean {
		return MathHelpers.HELPER_NAMES_SET.has(name);
	}
}
