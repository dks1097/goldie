import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureLocales, capturesPerLocale, rawDirFor } from "./capture.ts";
import { flowPath, selectLocales } from "./config.ts";

const outDir = "/tmp/app/goldie/out";
const locales = ["pt-PT", "en-US"];

describe("localizedCaptures", () => {
  test("off: one shared capture, in the first locale, for every locale", () => {
    const cfg = { outDir, locales, localizedCaptures: false };
    expect(capturesPerLocale(cfg, "iphone-6.9")).toBe(false);
    expect(rawDirFor(cfg, "iphone-6.9", "en-US")).toBe(join(outDir, "raw", "iphone-6.9"));
    expect(captureLocales(cfg, "iphone-6.9")).toEqual(["pt-PT"]);
  });

  test("on: iOS devices capture each locale into its own raw dir", () => {
    const cfg = { outDir, locales, localizedCaptures: true };
    expect(capturesPerLocale(cfg, "ipad-13")).toBe(true);
    expect(rawDirFor(cfg, "ipad-13", "en-US")).toBe(join(outDir, "raw", "ipad-13", "en-US"));
    expect(captureLocales(cfg, "iphone-6.9")).toEqual(locales);
    // --locale narrows a per-locale run to the requested locale.
    expect(captureLocales(cfg, "iphone-6.9", ["en-US"])).toEqual(["en-US"]);
  });

  test("on: android keeps one shared capture, since emulators are not locale-pinned", () => {
    const cfg = { outDir, locales, localizedCaptures: true };
    expect(capturesPerLocale(cfg, "pixel-10-pro")).toBe(false);
    expect(rawDirFor(cfg, "pixel-10-pro", "en-US")).toBe(join(outDir, "raw", "pixel-10-pro"));
    expect(captureLocales(cfg, "pixel-10-pro", ["en-US"])).toEqual(["pt-PT"]);
  });
});

describe("--locale", () => {
  test("runs every configured locale, or the one requested", () => {
    expect(selectLocales(locales)).toEqual(locales);
    expect(selectLocales(locales, "en-US")).toEqual(["en-US"]);
  });

  test("rejects a locale outside the config, so it never becomes a path", () => {
    expect(() => selectLocales(locales, "en-us")).toThrow('Unknown locale "en-us"');
    expect(() => selectLocales(locales, "../../outside")).toThrow("Unknown locale");
  });
});

describe("per-device flows", () => {
  test("a device replays its own copy under flowsDir/<device>/, else the shared flow", () => {
    const flowsDir = mkdtempSync(join(tmpdir(), "goldie-flows-"));
    writeFileSync(join(flowsDir, "home.yaml"), "steps: []\n");
    mkdirSync(join(flowsDir, "ipad-13"));
    writeFileSync(join(flowsDir, "ipad-13", "home.yaml"), "steps: []\n");
    expect(flowPath({ flowsDir }, "home", "ipad-13")).toBe(join(flowsDir, "ipad-13", "home.yaml"));
    expect(flowPath({ flowsDir }, "home", "iphone-6.9")).toBe(join(flowsDir, "home.yaml"));
    expect(flowPath({ flowsDir }, "home")).toBe(join(flowsDir, "home.yaml"));
  });
});
