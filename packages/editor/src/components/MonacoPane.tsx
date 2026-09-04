/*
 * One Monaco pane, as a React component — and the only module in the editor
 * that imports Monaco.
 *
 * That is why `CodeEditor.tsx` exists next door: it loads this one when a view
 * that needs it is opened, so the four megabytes of code editor are not in the
 * chunk that draws the yard.
 *
 * Written by hand rather than taken from a wrapper package, because the whole
 * of what a wrapper does is the three paragraphs below and every one of them
 * is a decision this editor has already made elsewhere.
 *
 * ## Models outlive the pane
 *
 * A model is Monaco's document: the text, its language, its undo history and
 * the URI the language service knows it by. This component creates one per
 * path and does not dispose it when the pane moves on, which is the point:
 * switching files must not throw away what somebody just typed or where their
 * cursor was. The editor is the disposable half; the models are the project.
 *
 * `documents` is why that matters beyond convenience. A script imports its
 * neighbour by a relative path, and a relative path resolves against a MODEL —
 * so a language service that has only ever been shown the open file reports
 * `./CharacterRegistry.js` as missing, which is both wrong and the first thing
 * anybody would see. Handing over the whole directory makes the service's view
 * of the project the same as the compiler's. A file that leaves the set is
 * disposed for the same reason: a deleted script that still had a model would
 * go on satisfying imports of itself.
 *
 * ## The buffer is the caller's
 *
 * `value` in, `onChange` out, like a controlled input, with one difference
 * that matters: a change coming back from Monaco must not be written into the
 * model again. Setting the text resets the cursor and the undo stack, so it
 * happens only when what the caller holds genuinely differs from what the
 * model has — a revert, a reload, a file that changed underneath.
 *
 * ## Indentation is per language
 *
 * The repository is tabs. YAML forbids them. So the model, which is where
 * Monaco keeps that setting, is told which it is when it is made.
 */

import Box from '@mui/material/Box';
import { useEffect, useRef } from 'react';

import { EDITOR_OPTIONS, monaco, setupMonaco } from '../monaco/monaco.js';


export type CodeLanguage = 'typescript' | 'yaml';

/** One squiggle, in the terms the caller has rather than Monaco's. */
export interface CodeMarker {
	/** One-based, as an editor counts. */
	readonly line: number;
	/** Zero-based, as a compiler counts. */
	readonly column: number;
	readonly length: number;
	readonly message: string;
}

export interface CodeEditorProps {
	/** The document's identity: `file:///scripts/Spin.ts`, or an asset path. */
	readonly uri: string;
	readonly language: CodeLanguage;
	readonly value: string;
	readonly readOnly?: boolean;
	/** What the compiler said about this file, if anything. */
	readonly markers?: readonly CodeMarker[];
	/**
	 * Every document in the same directory, by URI — the whole set, so one can
	 * import another and a removal is a removal. Omit where there is nothing to
	 * resolve, which is every file that is not code.
	 */
	readonly documents?: ReadonlyMap<string, string>;
	onChange(value: string): void;
	/** Ctrl-S, or Cmd-S. Absent where there is nothing to save to. */
	onSave?(): void;
}

/** Everything this component owns, so an effect can hand it to the next one. */
interface Pane {
	readonly editor: monaco.editor.IStandaloneCodeEditor;
	/** Where the cursor and the scroll were, per document. */
	readonly states: Map<string, monaco.editor.ICodeEditorViewState | null>;
}

/** The marker owner, so that setting ours never clears the language service's. */
const OWNER = 'hexdelve';

export function MonacoPane({
	uri,
	language,
	value,
	readOnly = false,
	markers = [],
	documents,
	onChange,
	onSave,
}: CodeEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const paneRef = useRef<Pane | null>(null);

	/*
	 * The live callbacks, so the editor is built once rather than rebuilt every
	 * time a parent re-renders with a new closure. Monaco's listeners read
	 * these; nothing else does.
	 */
	const handlers = useRef({ onChange, onSave });
	handlers.current = { onChange, onSave };

	// The text a model would be created with, if this path has none yet.
	const latest = useRef(value);
	latest.current = value;

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		setupMonaco();
		const editor = monaco.editor.create(host, { ...EDITOR_OPTIONS });
		const pane: Pane = { editor, states: new Map() };
		paneRef.current = pane;

		const typed = editor.onDidChangeModelContent(() => {
			const model = editor.getModel();
			if (model) handlers.current.onChange(model.getValue());
		});

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			handlers.current.onSave?.();
		});

		return () => {
			typed.dispose();
			// The models stay. See the header: the language service needs them
			// all, and a file being closed is not a file being forgotten.
			editor.dispose();
			paneRef.current = null;
		};
	}, []);

	// Which document is in front, and where it was left.
	useEffect(() => {
		const pane = paneRef.current;
		if (!pane) return;
		const { editor, states } = pane;

		const previous = editor.getModel();
		if (previous) states.set(previous.uri.toString(), editor.saveViewState());

		const target = monaco.Uri.parse(uri);
		const model =
			monaco.editor.getModel(target) ??
			monaco.editor.createModel(latest.current, language, target);
		// Tabs in a script, spaces in YAML, decided where the language is known.
		model.updateOptions({ insertSpaces: language === 'yaml', tabSize: 2 });

		if (model !== previous) {
			editor.setModel(model);
			const state = states.get(uri);
			if (state) editor.restoreViewState(state);
		}
	}, [uri, language]);

	/*
	 * The rest of the directory, so that an import of it resolves.
	 *
	 * The open document is skipped: it is the effect below that owns what is in
	 * the model, and setting the text from here would fight it keystroke by
	 * keystroke.
	 */
	useEffect(() => {
		if (!documents) return;
		const root = uri.slice(0, uri.lastIndexOf('/') + 1);

		for (const [path, text] of documents) {
			if (path === uri) continue;
			const target = monaco.Uri.parse(path);
			const model = monaco.editor.getModel(target);
			if (!model) monaco.editor.createModel(text, language, target);
			else if (model.getValue() !== text) model.setValue(text);
		}

		for (const model of monaco.editor.getModels()) {
			const path = model.uri.toString();
			if (path.startsWith(root) && path !== uri && !documents.has(path)) model.dispose();
		}
	}, [documents, language, uri]);

	// The caller's text, when it is not already the model's.
	useEffect(() => {
		const model = paneRef.current?.editor.getModel();
		if (model && model.getValue() !== value) model.setValue(value);
	}, [value]);

	useEffect(() => {
		paneRef.current?.editor.updateOptions({ readOnly });
	}, [readOnly]);

	// What the compiler said, on the lines it said it about.
	useEffect(() => {
		const model = paneRef.current?.editor.getModel();
		if (!model) return;
		monaco.editor.setModelMarkers(
			model,
			OWNER,
			markers.map((marker) => {
				const column = marker.column + 1; // Monaco counts from one.
				return {
					severity: monaco.MarkerSeverity.Error,
					message: marker.message,
					startLineNumber: marker.line,
					startColumn: column,
					endLineNumber: marker.line,
					endColumn: column + Math.max(marker.length, 1),
				};
			}),
		);
	}, [markers]);

	return <Box ref={hostRef} sx={{ flex: 1, minHeight: 0, minWidth: 0 }} />;
}
