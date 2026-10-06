import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRunOverrides, configForDevice, isScreenshot, loadConfig } from "./config.ts";

const shot = (id: string) =>
  `{ kind: "screenshot", id: "${id}", flow: "${id}", headline: { "en-US": "${id}" } }`;

/** A config with four screenshot scenes and a preview, plus the given goldie.design.json. */
async function load(design: object) {
  const dir = mkdtempSync(join(tmpdir(), "goldie-config-"));
  writeFileSync(
    join(dir, "goldie.config.ts"),
    `export default {
      appRoot: "${dir}",
      appPath: "${dir}/App.app",
      bundleId: "com.example.app",
      devices: ["iphone-6.9", "ipad-13"],
      locales: ["en-US"],
      appearance: "dark",
      frame: { variant: "17-pro-blue" },
      theme: { background: "#FFFFFF", headlineColor: "#000000", subheadColor: "#333333", fontFamily: "system-ui", template: "storyboard" },
      store: { name: "App" },
      scenes: [
        ${shot("agenda")}, ${shot("clients")}, ${shot("home")}, ${shot("team")},
        { kind: "preview", id: "preview", segments: [{ id: "a", flow: "a" }] },
      ],
    };\n`,
  );
  writeFileSync(join(dir, "goldie.design.json"), JSON.stringify(design));
  return loadConfig(join(dir, "goldie.config.ts"));
}

const ids = (scenes: Array<{ id: string }>) => scenes.map((s) => s.id);
const shots = (cfg: Awaited<ReturnType<typeof load>>) => ids(cfg.scenes.filter(isScreenshot));

describe("per-device designs", () => {
  test("without one, every device shares the design, hidden scenes left out", async () => {
    const cfg = await load({ order: ["clients", "agenda"], hidden: ["team"] });
    for (const device of ["iphone-6.9", "ipad-13"] as const) {
      expect(shots(configForDevice(cfg, device))).toEqual(["clients", "agenda", "home"]);
    }
    // The loaded config itself keeps every scene; the studio lists hidden ones to bring back.
    expect(shots(cfg)).toEqual(["clients", "agenda", "home", "team"]);
  });

  test("a device that opted in uses its own strip, not the shared one", async () => {
    const cfg = await load({
      order: ["home", "agenda"],
      hidden: ["team"],
      template: "storyboard",
      copy: { agenda: { headline: { "en-US": "Shared" } } },
      devices: {
        "ipad-13": {
          order: ["team", "agenda", "clients"],
          hidden: ["home", "preview"],
          template: "",
          layout: "hero",
          copy: { agenda: { headline: { "en-US": "For providers" } } },
        },
      },
    });
    const iphone = configForDevice(cfg, "iphone-6.9");
    expect(shots(iphone)).toEqual(["home", "agenda", "clients"]);
    expect(iphone.scenes.some((s) => s.kind === "preview")).toBe(true);
    expect(iphone.theme.template).toBe("storyboard");

    const ipad = configForDevice(cfg, "ipad-13");
    expect(shots(ipad)).toEqual(["team", "agenda", "clients"]);
    expect(ipad.scenes.some((s) => s.kind === "preview")).toBe(false);
    expect(ipad.theme.template).toBeUndefined();
    expect(ipad.theme.layout).toBe("hero");
    const agenda = ipad.scenes.find((s) => s.id === "agenda");
    expect(agenda && isScreenshot(agenda) ? agenda.headline["en-US"] : "").toBe("For providers");
  });

  test("in a device's own design the template reaches scenes the config gives a layout", async () => {
    const cfg = await load({ devices: { "ipad-13": { template: "dynamic" } } });
    cfg.stripBase?.scenes.forEach((s) => {
      if (s.id === "clients" && isScreenshot(s)) s.layout = "hero";
    });
    const clients = configForDevice(cfg, "ipad-13").scenes.find((s) => s.id === "clients");
    expect(clients && isScreenshot(clients) ? clients.layout : "x").toBeUndefined();
  });

  test("the look stays shared, and one-run flags reach a device's own design", async () => {
    const cfg = await load({
      background: "#101010",
      devices: { "ipad-13": { template: "" } },
    });
    applyRunOverrides(cfg, { layout: "minimal" });
    const ipad = configForDevice(cfg, "ipad-13");
    expect(ipad.theme.background).toBe("#101010");
    expect(ipad.theme.layout).toBe("minimal");
  });

  test("a hidden scene still lends its capture to a two-screen layout that names it", async () => {
    const cfg = await load({ hidden: ["home"] });
    cfg.scenes = cfg.scenes.map((s) =>
      s.id === "agenda" ? { ...s, secondScene: "home", layout: "panorama-duo" } : s,
    );
    const view = configForDevice(cfg, "ipad-13");
    const agenda = view.scenes.find((s) => s.id === "agenda");
    expect(agenda && isScreenshot(agenda) ? agenda.secondScene : "x").toBe("home");
    expect(shots(view)).not.toContain("home");
    expect(view.lentScenes?.map((s) => s.id)).toEqual(["home"]);
  });

  test("a hidden secondScene no layout draws is dropped and not captured", async () => {
    const cfg = await load({ hidden: ["home"] });
    cfg.scenes = cfg.scenes.map((s) =>
      s.id === "agenda" ? { ...s, secondScene: "home", layout: "hero" } : s,
    );
    const view = configForDevice(cfg, "ipad-13");
    const agenda = view.scenes.find((s) => s.id === "agenda");
    expect(agenda && isScreenshot(agenda) ? agenda.secondScene : "x").toBeUndefined();
    expect(view.lentScenes).toEqual([]);
  });
});
