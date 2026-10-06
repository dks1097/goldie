import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import {
  designHandler,
  exportHandler,
  removeHandler,
  type StudioApi,
  studioPaths,
} from "../src/studio-server.ts";

const SRC_DIR = resolve(import.meta.dirname, "src");
const GOLDIE_ROOT = resolve(import.meta.dirname, "..");

// GOLDIE_CONFIG points at a config outside this repo; out/ and the design
// sidecar live next to it.
const CONFIG = process.env.GOLDIE_CONFIG
  ? resolve(process.env.GOLDIE_CONFIG)
  : join(GOLDIE_ROOT, "goldie.config.ts");
const PATHS = studioPaths(CONFIG);

/**
 * Dev server: `out/web` is the static root - the manifest, the bezel art and
 * symlinks to the raw captures and finished assets, all served from `/`.
 * Nothing is copied into the studio, so a re-run of `goldie capture` shows
 * up on reload. Run `goldie manifest` first; the directory does not exist
 * before that. `fs.allow` covers the goldie root because the studio imports
 * src/layouts.ts for the shared geometry.
 *
 * Build: no publicDir, so studio/dist is just the app shell. `goldie studio`
 * serves it together with the app's out/web and the same API (see
 * src/studio-server.ts); that is what the npm package ships.
 */
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), goldieApi()],
  resolve: { alias: { "@": SRC_DIR } },
  publicDir: command === "build" ? false : PATHS.webDir,
  server: { port: 4321, open: true, fs: { allow: [GOLDIE_ROOT, PATHS.outDir] } },
}));

/** Mounts the shared /api handlers on the dev server, running the CLI from source. */
function goldieApi(): Plugin {
  const api: StudioApi = { paths: PATHS, cli: ["bun", join(GOLDIE_ROOT, "src", "cli.ts")] };
  const design = designHandler(api);
  const exp = exportHandler(api);
  const remove = removeHandler(api);
  return {
    name: "goldie-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/design", design);
      server.middlewares.use("/api/export", (req, res) => exp(req.url ?? "")(req, res));
      server.middlewares.use("/api/remove", remove);
    },
  };
}
