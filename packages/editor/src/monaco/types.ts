/*
 * The declarations a script is written against, handed to the language
 * service.
 *
 * Without these, the code editor is a syntax highlighter with opinions: it
 * knows `class` from `const` and nothing about `Script`, so `this.transform`
 * is an error, `param(1, { min: -6 })` has nothing to say for itself, and a
 * misspelt method is discovered by the compiler a save later. With them it is
 * the same answer `npm run typecheck` gives, because they are the same files —
 * the `dist/*.d.ts` that `tsc -b` emits, gathered by the dev server or emitted
 * into the build. See `SCRIPT_TYPES` in vite.assets.mts.
 *
 * They are named as if they were installed. `file:///node_modules/@hexdelve/
 * engine/package.json` and the declarations beside it are what Node's
 * resolution algorithm — which is what the language service is configured to
 * use — walks up to find from `file:///scripts/Spin.ts`. So a script says
 * `import { Script } from '@hexdelve/engine'`, exactly as it does on disk,
 * and nothing has to be rewritten for the editor's benefit.
 *
 * Loaded once. The declarations change when a package is rebuilt, which is not
 * something that happens while a page is up, and re-adding an extra library is
 * how the same file ends up in the service twice.
 *
 * Monaco is reached by a dynamic import rather than a plain one, for the same
 * reason `CodeEditor.tsx` loads its pane that way: the script view names this
 * module to put a count in its status line, and a status line must not drag a
 * language service into the chunk that draws the yard.
 */

/** Where the declarations answer, relative to the page. */
const SCRIPT_TYPES = 'script-types.json';

export interface ScriptTypes {
	readonly files: Record<string, string>;
	readonly missing: readonly string[];
}

export interface ScriptTypesState {
	/** How many declaration files the service was given. */
	readonly count: number;
	/** Packages with no `dist/` on disk. Completions will be thinner. */
	readonly missing: readonly string[];
	/** Why there are none at all, when there are none at all. */
	readonly error: string | null;
}

let loading: Promise<ScriptTypesState> | null = null;

/**
 * Read the declarations and register them, once.
 *
 * Never rejects. A failure here costs completions, not the editor, and an
 * editor that refused to open a file because it could not describe it would be
 * a poor trade — so the reason comes back to be shown beside the file list.
 */
export function loadScriptTypes(): Promise<ScriptTypesState> {
	loading ??= read().catch((error: unknown) => ({
		count: 0,
		missing: [],
		error: error instanceof Error ? error.message : String(error),
	}));
	return loading;
}

async function read(): Promise<ScriptTypesState> {
	const { typescriptDefaults } = await import(
		'monaco-editor/languages/features/typescript/register.js'
	);

	const response = await fetch(`${SCRIPT_TYPES}?t=${Date.now()}`);
	if (!response.ok) {
		throw new Error(`cannot read ${SCRIPT_TYPES}: ${response.status} ${response.statusText}`);
	}
	const types = (await response.json()) as ScriptTypes;

	let count = 0;
	for (const [path, text] of Object.entries(types.files)) {
		typescriptDefaults.addExtraLib(text, `file:///${path}`);
		count++;
	}
	return { count, missing: types.missing ?? [], error: null };
}
