import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    watch: {
      // Do not reload the browser for files the app does not serve.
      //
      // A test run writes 5.5MB of HTML into coverage/, and the file watcher
      // and its snapshots write to logs/ every time a watched file changes.
      // Vite treated both as source and force-reloaded every open page: 1,064
      // reloads in one day. A forced reload throws away the editor's buffer,
      // so running the test suite could discard whatever was being typed in
      // another window. Scratch work in _tmp/ is the same story.
      ignored: ["**/coverage/**", "**/logs/**", "**/_tmp/**", "**/.wrangler/**"],
    },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
