import { existsSync } from "node:fs";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureManifest } from "./capture.ts";
import { designPath, type LoadedConfig, type StripDesign } from "./config.ts";

/**
 * `goldie remove <scene-id>`: drops a scene (a screenshot, or the preview)
 * from every device. It leaves the config, its captures, the rendered files
 * and the studio's design; the argent flows stay, being the app's own code.
 */
export async function removeScene(cfg: LoadedConfig, id: string): Promise<string[]> {
  if (!cfg.scenes.some((s) => s.id === id)) {
    throw new Error(`No scene "${id}" in ${cfg.configPath}.`);
  }
  const done: string[] = [];

  const source = await readFile(cfg.configPath, "utf8");
  await writeAtomic(cfg.configPath, removeSceneFromSource(source, id));
  done.push(`removed "${id}" from ${cfg.configPath}`);

  const design = designPath(cfg.configPath);
  if (existsSync(design)) {
    const parsed = JSON.parse(await readFile(design, "utf8"));
    forgetScene(parsed, id);
    for (const strip of Object.values(parsed.devices ?? {})) forgetScene(strip as StripDesign, id);
    await writeAtomic(design, `${JSON.stringify(parsed, null, 2)}\n`);
    done.push(`dropped "${id}" from ${design}`);
  }

  const preview = cfg.scenes.find((s) => s.id === id)?.kind === "preview";
  for (const manifest of await findFiles(join(cfg.outDir, "raw"), (n) => n === "manifest.json")) {
    const raw: CaptureManifest = JSON.parse(await readFile(manifest, "utf8"));
    const files = preview
      ? (raw.preview?.clips.map((c) => c.file) ?? [])
      : raw.screenshots.filter((s) => s.sceneId === id).map((s) => s.file);
    if (files.length === 0) continue;
    for (const file of files) await rm(file, { force: true });
    if (preview) raw.preview = null;
    else raw.screenshots = raw.screenshots.filter((s) => s.sceneId !== id);
    await writeAtomic(manifest, JSON.stringify(raw, null, 2));
    done.push(`deleted ${files.length} capture(s) listed in ${manifest}`);
  }

  // Rendered files are named "<index>-<sceneId>.png" (a panorama adds "-<n>").
  const rendered = preview
    ? await findFiles(join(cfg.outDir, "previews"), (n) => n.endsWith(".mp4"))
    : await findFiles(join(cfg.outDir, "screenshots"), (n) =>
        new RegExp(`^\\d+-${escapeRegExp(id)}(-\\d+)?\\.png$`).test(n),
      );
  for (const file of rendered) await rm(file, { force: true });
  if (rendered.length > 0) done.push(`deleted ${rendered.length} rendered file(s)`);
  return done;
}

/** Drops a scene id from a strip design's per-scene fields. */
function forgetScene(strip: StripDesign, id: string): void {
  if (strip.order) strip.order = strip.order.filter((s) => s !== id);
  if (strip.hidden) strip.hidden = strip.hidden.filter((s) => s !== id);
  if (strip.copy) delete strip.copy[id];
  if (strip.sceneLayouts) delete strip.sceneLayouts[id];
}

/**
 * The config source without the scene whose `id` is the given one: its object
 * literal in the `scenes: [...]` array, the comma after it and the rest of its
 * line. Everything else keeps its formatting and comments. Throws when the
 * array or the scene is not written out literally (built by code, say).
 */
export function removeSceneFromSource(source: string, id: string): string {
  const tokens = scan(source);
  const scenesKey = tokens.findIndex(
    (t, i) => t.kind === "word" && t.text === "scenes" && tokens[i + 1]?.text === ":",
  );
  if (scenesKey === -1 || tokens[scenesKey + 2]?.text !== "[") {
    throw new Error(
      "Could not find a literal `scenes: [...]` in the config; remove the scene by hand.",
    );
  }
  // Walk the array's top-level elements.
  let depth = 0;
  let element: { start: number; idValue?: string } | null = null;
  for (let i = scenesKey + 2; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.text === "[" || t.text === "{" || t.text === "(") depth++;
    if (depth === 2 && t.text === "{") element = { start: t.start };
    if (
      element &&
      depth === 2 &&
      t.kind === "word" &&
      t.text === "id" &&
      tokens[i + 1]?.text === ":" &&
      tokens[i + 2]?.kind === "string"
    ) {
      element.idValue = tokens[i + 2]!.value;
    }
    if (t.text === "]" || t.text === "}" || t.text === ")") {
      if (depth === 2 && t.text === "}" && element) {
        if (element.idValue === id) {
          let end = t.end;
          if (tokens[i + 1]?.text === ",") end = tokens[i + 1]!.end;
          const lineStart = source.lastIndexOf("\n", element.start - 1) + 1;
          const lineEnd = source.indexOf("\n", end);
          const onlyBefore = source.slice(lineStart, element.start).trim() === "";
          const onlyAfter = source.slice(end, lineEnd === -1 ? undefined : lineEnd).trim() === "";
          const from = onlyBefore ? lineStart : element.start;
          const to = onlyAfter && lineEnd !== -1 ? lineEnd + 1 : end;
          return source.slice(0, from) + source.slice(to);
        }
        element = null;
      }
      depth--;
      if (depth === 0) break;
    }
  }
  throw new Error(
    `Scene "${id}" is not written literally in the config's scenes; remove it by hand.`,
  );
}

type Token = {
  kind: "word" | "string" | "punct";
  text: string;
  value?: string;
  start: number;
  end: number;
};

/** Just enough of a JS/TS tokenizer to walk object literals: strings and comments are skipped over whole. */
function scan(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close === -1 ? src.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      let value = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") {
          value += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        value += src[i];
        i++;
      }
      i++;
      out.push({ kind: "string", text: src.slice(start, i), value, start, end: i });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < src.length && /[\w$]/.test(src[i]!)) i++;
      out.push({ kind: "word", text: src.slice(start, i), start, end: i });
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    out.push({ kind: "punct", text: c, start: i, end: i + 1 });
    i++;
  }
  return out;
}

async function findFiles(dir: string, match: (name: string) => boolean): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && match(e.name)).map((e) => join(e.parentPath, e.name));
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
