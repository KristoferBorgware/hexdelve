/*
 * Monaco, set up once, for every text pane in the editor.
 *
 * ## Why a code editor at all
 *
 * The scripts are the client's own source. They were always meant to be
 * written in whatever editor somebody already had, saved, and hot-reloaded
 * into a running yard — which works, and leaves the one program that knows
 * what a script IS with a text box in it. What Monaco adds is the half a text
 * box cannot: `this.transform.` completes to the fields a transform has,
 * `param(` shows what its options are, and a name that does not exist is
 * underlined where it is written rather than in a compiler message about a
 * bundle. The declarations that make all three work are read from the same
 * `dist/` that `npm run typecheck` checks the scripts against — see
 * `types.ts`, and `SCRIPT_TYPES` in vite.assets.mts.
 *
 * ## What is imported, and what is deliberately not
 *
 * `editor.main.js` is the editor and every contribution it has — the find
 * widget, the suggestion list, the cursor commands — and NO languages. The
 * package's own entry point adds eighty of them, from ABAP to WGSL, and this
 * editor has exactly two kinds of file in it. So the two are named
 * individually: the TypeScript language service, which is the whole point, and
 * the YAML tokenizer for the asset files.
 *
 * The types come from `editor.api.js`, which is the same module `editor.main`
 * re-exports and the only one of the two with declarations beside it.
 *
 * ## Workers
 *
 * Monaco does its language work off the main thread, which is why an editor
 * with a type checker in it does not stutter while somebody types. Vite's
 * `?worker` import is how those two files become workers here — they are
 * bundled separately and constructed by `MonacoEnvironment`, which is the hook
 * Monaco looks for. Without it Monaco tries to load them by URL from a base
 * path it has no way to know, which is the failure everybody who has ever
 * integrated this thing has seen once.
 */

import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/editor.main.js';
import {
	ModuleKind,
	ModuleResolutionKind,
	ScriptTarget,
	typescriptDefaults,
} from 'monaco-editor/languages/features/typescript/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

export { monaco };

/** The theme's name, wherever an editor is created. */
export const THEME = 'hexdelve';

let ready = false;

/**
 * Set Monaco up, once.
 *
 * Idempotent because two views create editors and either may be first, and
 * because a dev-server reload re-runs this module against a page that already
 * has a theme by this name.
 */
export function setupMonaco(): typeof monaco {
	if (ready) return monaco;
	ready = true;

	self.MonacoEnvironment = {
		getWorker(_id: string, label: string): Worker {
			// One worker per language service, and the plain one for everything
			// else — tokenizing, whitespace, links.
			if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
			return new EditorWorker();
		},
	};

	/*
	 * The same options the scripts are actually compiled with, as closely as
	 * this service can state them.
	 *
	 * `experimentalDecorators` is the one that matters: `@on(Damage)` is a
	 * legacy decorator, which is the design esbuild implements and what
	 * `packages/client/scripts/tsconfig.json` turns on for the same reason.
	 * Without it every handler in the scripts is a syntax error on screen and
	 * compiles perfectly.
	 *
	 * The target is ESNext rather than the repository's ES2022 because
	 * Monaco's own `ScriptTarget` stops at ES2020 and cannot say ES2022. It is
	 * a superset, nothing here emits anything, and what the browser runs is
	 * whatever esbuild produced at ES2022 — see `compiler.ts`.
	 */
	typescriptDefaults.setCompilerOptions({
		target: ScriptTarget.ESNext,
		module: ModuleKind.ESNext,
		moduleResolution: ModuleResolutionKind.NodeJs,
		strict: true,
		noImplicitOverride: true,
		useDefineForClassFields: true,
		experimentalDecorators: true,
		skipLibCheck: true,
		allowNonTsExtensions: true,
		noEmit: true,
	});

	// Every open model reaches the worker as soon as it changes, rather than
	// when something asks. The files are a few kilobytes each.
	typescriptDefaults.setEagerModelSync(true);

	monaco.editor.defineTheme(THEME, {
		base: 'vs-dark',
		inherit: true,
		rules: [
			{ token: 'comment', foreground: '6f7d68', fontStyle: 'italic' },
			{ token: 'keyword', foreground: '8fbc5c' },
			{ token: 'string', foreground: 'c8a44a' },
			{ token: 'number', foreground: 'd0b06a' },
			{ token: 'type', foreground: 'a8cfe0' },
		],
		colors: {
			// The panel's own background, so the pane is part of the window
			// rather than a rectangle sitting on it.
			'editor.background': '#1b201c',
			'editorGutter.background': '#1b201c',
			'editorLineNumber.foreground': '#4d5a4c',
			'editorLineNumber.activeForeground': '#8fbc5c',
			'editor.lineHighlightBackground': '#232a24',
			'editor.selectionBackground': '#3a5030',
			'editorIndentGuide.background1': '#2b332b',
			'editorWidget.background': '#232a24',
			'editorWidget.border': '#33403300',
		},
	});

	return monaco;
}

/**
 * The options every pane shares, whatever is in it.
 *
 * Indentation is NOT among them, and cannot be: this repository is written
 * with tabs and YAML forbids them outright, so a script and an asset file
 * disagree about the one setting a text editor most obviously has. It is set
 * per model in `CodeEditor`, where the language is known.
 */
export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
	theme: THEME,
	automaticLayout: true,
	fontSize: 12.5,
	lineHeight: 1.55 * 12.5,
	fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
	minimap: { enabled: false },
	scrollBeyondLastLine: false,
	renderWhitespace: 'selection',
	smoothScrolling: true,
	padding: { top: 12, bottom: 12 },
};
