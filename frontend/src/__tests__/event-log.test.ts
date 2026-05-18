import { describe, expect, it } from "vitest";
import { HOOK_PANEL_EMPTY_TEXT, HOOK_PANEL_GUIDANCE_TEXT } from "../components/EventLog";

describe("EventLog hook panel guidance", () => {
  it("distinguishes left-click selection from right-click action wheel behavior", () => {
    expect(HOOK_PANEL_GUIDANCE_TEXT).toBe("Left-click: select | Right-click: action wheel");
    expect(HOOK_PANEL_EMPTY_TEXT).toBe("NO TRACKS HOOKED — left-click a map marker or use TRACKS list");
  });
});
