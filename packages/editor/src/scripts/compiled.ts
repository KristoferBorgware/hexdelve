/*
 * The compiled scripts, kept in one place for whoever only needs to read them.
 *
 * Three views ask what the client's scripts compile to. The yard's watcher
 * needs a running host it can rebuild. The entity bench needs the classes, to
 * read a script's declared parameters off them. Both want the same answer —
 * what is actually on disk — and used to each compile it independently: two
 * calls to esbuild from the same source directory, a moment apart, that could
 * disagree with each other and with nothing on screen saying so.
 *
 * This compiles once, on first ask, and again only when the disk changes: a
 * write or a delete made through `writeScript`/`removeScript` below, or a file
 * changed by something else entirely — another window, another editor — which
 * Vite's dev server announces the same way it always has. Everyone who asks in
 * between gets the one answer that is current.
 *
 * ## What this deliberately does not cover
 *
 * The scripts VIEW compiles too, and stays outside this — it compiles the
 * BUFFERS somebody is typing into, which are not always what is on disk, into
 * a preview world of its own. Folding that in would mean every keystroke there
 * recompiled the entity bench's controls out from under whoever is looking at
 * them, which is worse than the duplication this replaces. Reading source text
 * to seed those buffers is a different need to this module's — a compiled
 * class, not the text that produced it — so the scripts view still reads the
 * store directly for that. What it must not do is write around this module:
 * `writeScript`/`removeScript` are the only writes that are also invalidations,
 * so every write goes through them.
 */

import { noScripts } from '@hexdelve/engine';
import { useEffect, useSyncExternalStore } from 'react';

import { compileScripts, type CompileResult } from './compiler.js';
import { scriptStore } from './store.js';

const IDLE: CompileResult = { provider: noScripts, error: null, diagnostics: [], names: [] };

let result: CompileResult = IDLE;
/** True once a compile has actually run, so a second `ensureCompiled` is free. */
let settled = false;
let running = false;
/** A write or a file change arrived while a compile was already in flight. */
let queued = false;
const listeners = new Set<() => void>();

/**
 * The one object a reader gets back, kept the same reference until something
 * actually changes.
 *
 * `useSyncExternalStore` compares what `getSnapshot` returns by identity, and
 * a snapshot rebuilt on every call is always "different" — which reads as an
 * infinite stream of changes and is treated as one: React refuses to settle
 * and reports it as a loop. `commit` is the only place `cached` is replaced,
 * and it runs exactly when `result` or `running` does.
 */
let cached: CompiledScripts = { ...IDLE, compiling: false };

function commit(): void {
	cached = { ...result, compiling: running };
	for (const listener of listeners) listener();
}

/**
 * Compile from disk, coalescing anything that asks while one is already
 * running rather than starting a second in parallel.
 *
 * A second ask while the first is still in flight is remembered and answered
 * with one more pass at the end, exactly once, rather than by racing two
 * compiles against each other — the same debounce the code this replaced used
 * for the same reason: a save and a hot-reload notification can arrive within
 * a moment of each other.
 */
async function cycle(): Promise<void> {
	if (running) {
		queued = true;
		return;
	}
	running = true;
	commit(); // Anyone reading the snapshot now sees `compiling: true`.

	try {
		const sources = await scriptStore.readAll();
		// The previous provider is the fallback, so a script that will not
		// build leaves whoever is running the last good compile alone rather
		// than going blank.
		result = await compileScripts(sources, result.provider);
	} catch (error) {
		result = {
			provider: result.provider,
			error: error instanceof Error ? error.message : String(error),
			diagnostics: [],
			names: result.provider.names,
		};
	} finally {
		settled = true;
		running = false;
		commit();
		if (queued) {
			queued = false;
			void cycle();
		}
	}
}

/**
 * The last compile, whatever it produced.
 *
 * `compiling` is not on `CompileResult` itself — that type is also what a
 * one-off caller like the entity bench's parameter reader gets, and whether a
 * NEW compile is in flight is a fact about this cache, not about the compile
 * that finished.
 */
export interface CompiledScripts extends CompileResult {
	readonly compiling: boolean;
}

/**
 * The current answer, read synchronously.
 *
 * For anything that is not a React component — `watchScripts` calls this from
 * inside its own subscription callback, since a `ScriptHost` is not a hook.
 */
export function compiledScriptsSnapshot(): CompiledScripts {
	return cached;
}

/**
 * Make sure a compile has run at least once, without forcing another.
 *
 * Every consumer calls this on mount. The first one to arrive starts the
 * compile; everyone after that finds `settled` already true and does nothing,
 * which is the whole of what "share one provider" means in practice.
 */
export function ensureCompiled(): void {
	if (!settled && !running) void cycle();
}

/** Recompile unconditionally, for a write, a delete, or a file changed elsewhere. */
function refresh(): void {
	void cycle();
}

export function subscribeCompiledScripts(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * The compiled scripts, kept current.
 *
 * `useSyncExternalStore` rather than a `useState` fed by an effect: several
 * components hold this at once and none of them owns the compile, which is
 * the point — one piece of state outside React, read by everyone who asks.
 */
export function useCompiledScripts(): CompiledScripts {
	useEffect(ensureCompiled, []);
	return useSyncExternalStore(subscribeCompiledScripts, compiledScriptsSnapshot);
}

/** Write a script back, and bring the shared compile in step with it. */
export async function writeScript(name: string, text: string): Promise<void> {
	await scriptStore.write(name, text);
	refresh();
}

/** Delete a script, and bring the shared compile in step with it. */
export async function removeScript(name: string): Promise<void> {
	await scriptStore.remove(name);
	refresh();
}

/*
 * Vite's own file watcher, registered once for the page rather than once per
 * consumer. The scripts are under the project, so a file changed by anything
 * other than this module — another editor, another window — already reaches
 * the page as a hot update, and there is nothing to poll.
 *
 * On a built page there is no `import.meta.hot`, so this never fires and the
 * one compile from `ensureCompiled` is the only one there ever is — which is
 * correct, since a built page has no files to change.
 */
const hot = (import.meta as { hot?: { on(event: string, handler: () => void): void } }).hot;
hot?.on('vite:afterUpdate', refresh);
