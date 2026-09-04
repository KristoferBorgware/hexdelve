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
