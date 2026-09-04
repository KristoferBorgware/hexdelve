/*
 * The two things Vite adds to a module that TypeScript does not know about.
 *
 * `?url` turns an import into the URL the bundler will serve that file from,
 * which is how esbuild's WebAssembly binary is found without hard-coding a
 * path that a build would move. `import.meta.hot` is the dev server's own file
 * watcher, and it is absent in a built page — which is why every use of it
 * here is optional rather than assumed.
 */

/// <reference types="vite/client" />

/*
 * Monaco ships declarations for `editor.api`, for each language's register
 * module and for nothing else. `editor.main` is the module that installs the
 * editor's own contributions — the find widget, the suggestion list, the
 * cursor commands — and it has none, because everything it exports is already
 * exported by `editor.api`, which is where this project takes its types from.
 *
 * So it is imported for its side effects and declared here as what it is: a
 * module with nothing to say. The alternative is the package's own entry
 * point, which carries all eighty of its languages into a bundle that needs
 * two.
 */
declare module 'monaco-editor/editor/editor.main.js';
