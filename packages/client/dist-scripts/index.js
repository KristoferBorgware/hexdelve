/*
 * Every script this build ships, by the name a prefab calls it.
 *
 * Written out rather than globbed, and the reason is what a glob would cost:
 * `import.meta.glob` is Vite's, so a client built with `tsc` would resolve
 * nothing, and the client is built both ways. An explicit list works
 * everywhere, is typechecked, and is one line per script.
 *
 * A list can drift from the directory beside it, so it is not left to
 * discipline: `test/scripts.test.ts` reads the directory and fails if a file
 * here is missing from this table. Add a script, add a line, and the test says
 * so if you forget.
 */
import { Spin } from './Spin.js';
export const scripts = {
    Spin,
};
//# sourceMappingURL=index.js.map