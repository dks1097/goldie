import { describe, expect, test } from "bun:test";
import { removeSceneFromSource } from "./remove.ts";

const config = `const config = {
  devices: ["iphone-6.9"],
  scenes: [
    // Opener: the agenda.
    {
      kind: "screenshot",
      id: "agenda",
      flow: "agenda", // the owner's week
      headline: { "en-US": "Your week, at a glance" },
    },
    { kind: "screenshot", id: 'clients', flow: "clients", headline: { "en-US": "Clients {all}" } },
    {
      kind: "preview",
      id: "preview",
      segments: [
        { id: "discover", flow: "a" },
        { id: "agenda", flow: "b" },
      ],
    },
  ],
};
`;

describe("goldie remove", () => {
  test("drops the scene's object and its line, keeping every other line as written", () => {
    const out = removeSceneFromSource(config, "agenda");
    expect(out).not.toContain('flow: "agenda"');
    expect(out).toContain("// Opener: the agenda.");
    expect(out).toContain(
      `    { kind: "screenshot", id: 'clients', flow: "clients", headline: { "en-US": "Clients {all}" } },\n`,
    );
    // A segment with the same id inside the preview is not a scene.
    expect(out).toContain('{ id: "agenda", flow: "b" }');
  });

  test("handles single-quoted ids, braces inside strings and a one-line scene", () => {
    const out = removeSceneFromSource(config, "clients");
    expect(out).not.toContain("clients");
    expect(out).toContain('id: "agenda"');
    expect(out.split("\n").length).toBe(config.split("\n").length - 1);
  });

  test("removes the preview, segments and all", () => {
    const out = removeSceneFromSource(config, "preview");
    expect(out).not.toContain('kind: "preview"');
    expect(out).not.toContain("discover");
    expect(out).toContain("id: 'clients'");
  });

  test("refuses when the scene or a literal scenes array is not there", () => {
    expect(() => removeSceneFromSource(config, "missing")).toThrow('Scene "missing"');
    expect(() => removeSceneFromSource("export default { scenes }", "agenda")).toThrow("by hand");
  });
});
