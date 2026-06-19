// Copy the Paged.js polyfill out of the installed package into public/ so the
// document print tab can load it as a plain <script> (the package's exports map
// does not expose the dist file to a bundler import). The npm package stays the
// single source; this just stages a served copy. Runs on prebuild/predev.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/pagedjs/dist/paged.polyfill.min.js");
const destDir = resolve(root, "public/vendor");
const dest = resolve(destDir, "paged.polyfill.js");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`vendored pagedjs polyfill -> ${dest}`);
