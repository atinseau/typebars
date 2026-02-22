import type { JSONSchema7 } from "json-schema";
import type { AnalysisResult, TemplateDiagnostic } from "./types.ts";

// ─── Utilitaires ─────────────────────────────────────────────────────────────
// Fonctions et classes utilitaires partagées par les différents modules
// du moteur de template.

// ─── Deep Equality ───────────────────────────────────────────────────────────
// Comparaison structurelle profonde pour des valeurs JSON-compatibles.
// Plus robuste que `JSON.stringify` car indépendant de l'ordre des clés
// et sans allocation de strings intermédiaires.

/**
 * Compare récursivement deux valeurs JSON-compatibles.
 *
 * @param a - Première valeur
 * @param b - Seconde valeur
 * @returns `true` si les deux valeurs sont structurellement identiques
 *
 * @example
 * ```
 * deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }) // → true
 * deepEqual([1, 2], [1, 2])                   // → true
 * deepEqual({ a: 1 }, { a: 2 })               // → false
 * ```
 */
export function deepEqual(a: unknown, b: unknown): boolean {
	// Identité stricte (couvre primitives, même ref, NaN !== NaN volontaire)
	if (a === b) return true;

	// null est typeof "object" en JS — on le traite à part
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;

	// ── Tableaux ────────────────────────────────────────────────────────────
	if (Array.isArray(a)) {
		if (!Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}

	// ── Objets ──────────────────────────────────────────────────────────────
	if (typeof a === "object") {
		const objA = a as Record<string, unknown>;
		const objB = b as Record<string, unknown>;
		const keysA = Object.keys(objA);
		const keysB = Object.keys(objB);

		if (keysA.length !== keysB.length) return false;

		for (const key of keysA) {
			if (!(key in objB) || !deepEqual(objA[key], objB[key])) return false;
		}
		return true;
	}

	// Primitives différentes (déjà couvert par a === b au début)
	return false;
}

// ─── LRU Cache ───────────────────────────────────────────────────────────────
// Cache à capacité fixe avec éviction LRU (Least Recently Used).
// Utilise l'ordre d'insertion de `Map` pour tracker l'accès : l'entrée
// la plus ancienne est toujours en première position.

/**
 * Cache LRU simple à capacité fixe.
 *
 * @example
 * ```
 * const cache = new LRUCache<string, number>(2);
 * cache.set("a", 1);
 * cache.set("b", 2);
 * cache.get("a");      // → 1 (marque "a" comme récemment utilisé)
 * cache.set("c", 3);   // évince "b" (le moins récemment utilisé)
 * cache.get("b");      // → undefined
 * ```
 */
export class LRUCache<K, V> {
	private readonly cache = new Map<K, V>();

	constructor(private readonly capacity: number) {
		if (capacity < 1) {
			throw new Error("LRUCache capacity must be at least 1");
		}
	}

	/**
	 * Récupère une valeur du cache. Retourne `undefined` si absente.
	 * Marque l'entrée comme récemment utilisée.
	 */
	get(key: K): V | undefined {
		if (!this.cache.has(key)) return undefined;

		// Déplacer en fin de Map (= plus récent)
		const value = this.cache.get(key) as V;
		this.cache.delete(key);
		this.cache.set(key, value);
		return value;
	}

	/**
	 * Insère ou met à jour une valeur dans le cache.
	 * Si le cache est plein, évince l'entrée la moins récemment utilisée.
	 */
	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.capacity) {
			// Évince la première entrée (la plus ancienne)
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey);
			}
		}
		this.cache.set(key, value);
	}

	/**
	 * Vérifie si une clé existe dans le cache (sans modifier l'ordre LRU).
	 */
	has(key: K): boolean {
		return this.cache.has(key);
	}

	/**
	 * Supprime une entrée du cache.
	 * @returns `true` si l'entrée existait et a été supprimée
	 */
	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	/** Vide entièrement le cache. */
	clear(): void {
		this.cache.clear();
	}

	/** Nombre d'entrées actuellement dans le cache. */
	get size(): number {
		return this.cache.size;
	}
}

// ─── Extraction de snippet source ────────────────────────────────────────────
// Utilisé pour enrichir les diagnostics avec le fragment de template
// qui a causé l'erreur.

/**
 * Extrait un fragment de template autour d'une position donnée.
 *
 * @param template - Le template source complet
 * @param loc      - La position (ligne/colonne, 1-based) de l'erreur
 * @returns Le fragment de code correspondant (trimé)
 */
export function extractSourceSnippet(
	template: string,
	loc: {
		start: { line: number; column: number };
		end: { line: number; column: number };
	},
): string {
	const lines = template.split("\n");
	const startLine = loc.start.line - 1; // 0-based
	const endLine = loc.end.line - 1;

	if (startLine < 0 || startLine >= lines.length) return "";

	if (startLine === endLine) {
		// Même ligne — extraire la portion entre start.column et end.column
		const line = lines[startLine] ?? "";
		return line.trim();
	}

	// Multi-lignes — retourner les lignes concernées
	const clampedEnd = Math.min(endLine, lines.length - 1);
	return lines
		.slice(startLine, clampedEnd + 1)
		.map((l) => l.trimEnd())
		.join("\n")
		.trim();
}

// ─── Schema Properties ──────────────────────────────────────────────────────
// Utilitaire pour lister les propriétés disponibles dans un schema,
// utilisé pour enrichir les messages d'erreur (suggestions).

/**
 * Liste les noms de propriétés déclarées dans un JSON Schema.
 * Retourne un tableau vide si le schema n'a pas de `properties`.
 */
export function getSchemaPropertyNames(schema: JSONSchema7): string[] {
	const names = new Set<string>();

	// Propriétés directes
	if (schema.properties) {
		for (const key of Object.keys(schema.properties)) {
			names.add(key);
		}
	}

	// Propriétés dans les combinateurs
	for (const combinator of ["allOf", "anyOf", "oneOf"] as const) {
		const branches = schema[combinator];
		if (branches) {
			for (const branch of branches) {
				if (typeof branch === "boolean") continue;
				if (branch.properties) {
					for (const key of Object.keys(branch.properties)) {
						names.add(key);
					}
				}
			}
		}
	}

	return Array.from(names).sort();
}

// ─── Agrégation d'analyses d'objets ──────────────────────────────────────────
// Factorise le pattern commun de récursion sur un objet template :
// itérer les clés, analyser chaque entrée via un callback, accumuler
// les diagnostics, construire le outputSchema objet.
//
// Utilisé par :
// - `analyzer.ts` (analyzeObjectTemplate)
// - `TemplateEngine.analyzeObject()` (index.ts)
// - `CompiledTemplate.analyze()` en mode objet (compiled-template.ts)

/**
 * Agrège les résultats d'analyse d'un ensemble d'entrées nommées en un
 * seul `AnalysisResult` avec un `outputSchema` de type objet.
 *
 * @param keys         - Les clés de l'objet à analyser
 * @param analyzeEntry - Callback qui analyse une entrée par sa clé
 * @returns Un `AnalysisResult` agrégé
 *
 * @example
 * ```
 * aggregateObjectAnalysis(
 *   Object.keys(template),
 *   (key) => analyze(template[key], inputSchema),
 * );
 * ```
 */
export function aggregateObjectAnalysis(
	keys: string[],
	analyzeEntry: (key: string) => AnalysisResult,
): AnalysisResult {
	const allDiagnostics: TemplateDiagnostic[] = [];
	const properties: Record<string, JSONSchema7> = {};
	let allValid = true;

	for (const key of keys) {
		const child = analyzeEntry(key);
		if (!child.valid) allValid = false;
		allDiagnostics.push(...child.diagnostics);
		properties[key] = child.outputSchema;
	}

	return {
		valid: allValid,
		diagnostics: allDiagnostics,
		outputSchema: {
			type: "object",
			properties,
			required: keys,
		},
	};
}

/**
 * Agrège les résultats d'analyse **et** d'exécution d'un ensemble d'entrées
 * nommées. Retourne à la fois l'`AnalysisResult` agrégé et l'objet des
 * valeurs exécutées (ou `undefined` si au moins une entrée est invalide).
 *
 * @param keys         - Les clés de l'objet
 * @param processEntry - Callback qui analyse et exécute une entrée par sa clé
 * @returns `{ analysis, value }` agrégés
 */
export function aggregateObjectAnalysisAndExecution(
	keys: string[],
	processEntry: (key: string) => { analysis: AnalysisResult; value: unknown },
): { analysis: AnalysisResult; value: unknown } {
	const allDiagnostics: TemplateDiagnostic[] = [];
	const properties: Record<string, JSONSchema7> = {};
	const resultValues: Record<string, unknown> = {};
	let allValid = true;

	for (const key of keys) {
		const child = processEntry(key);
		if (!child.analysis.valid) allValid = false;
		allDiagnostics.push(...child.analysis.diagnostics);
		properties[key] = child.analysis.outputSchema;
		resultValues[key] = child.value;
	}

	const analysis: AnalysisResult = {
		valid: allValid,
		diagnostics: allDiagnostics,
		outputSchema: {
			type: "object",
			properties,
			required: keys,
		},
	};

	return {
		analysis,
		value: allValid ? resultValues : undefined,
	};
}
