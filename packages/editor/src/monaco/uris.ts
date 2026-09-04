/*
 * Where a document lives, as the language service sees it.
 *
 * These are not file paths and they are not URLs anybody fetches. They are the
 * identities Monaco keeps its models under, and they matter for one reason: a
 * script that imports another script does it by a relative path, and a
 * relative path resolves against the importer's URI. So the scripts sit in a
 * directory of their own, the packages they import are extra libraries under
 * `file:///node_modules` — which is exactly where Node's resolution algorithm
 * looks from `file:///scripts/` — and nothing about an import has to be
 * rewritten for the editor's benefit.
 *
 * They live in a module of their own, with no import of Monaco in it, so that
 * a view can name a document without dragging a code editor into the bundle
 * that draws the yard. See `CodeEditor.tsx`.
 */

/** Where a script's model lives. The trailing slash is load-bearing. */
export const SCRIPT_ROOT = 'file:///scripts/';

/** Where an asset file's model lives. Nothing resolves anything from here. */
export const ASSET_ROOT = 'file:///assets/';
