import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Local gmist (preview:local) builds into its own folder, so `npm run deploy`
  // can rebuild `build/` while a local gmist is serving.
  buildDirectory: process.env.GMIST_BUILD_DIR || "build",
  future: {
    v8_viteEnvironmentApi: true,
    v8_middleware: true,
  },
} satisfies Config;
