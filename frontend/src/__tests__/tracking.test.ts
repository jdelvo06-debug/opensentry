import { describe, expect, it } from "vitest";
import {
  isLocalDevHost,
  loadSavedTrackingProfile,
  saveTrackingProfile,
} from "../utils/tracking";

describe("usage tracking helpers", () => {
  it("bypasses the gate for localhost and loopback hosts", () => {
    expect(isLocalDevHost("localhost")).toBe(true);
    expect(isLocalDevHost("127.0.0.1")).toBe(true);
    expect(isLocalDevHost("[::1]")).toBe(true);
  });

  it("does not bypass the gate for GitHub Pages", () => {
    expect(isLocalDevHost("jdelvo06-debug.github.io")).toBe(false);
  });

  it("saves and loads the last tracking profile", () => {
    const storage = new Map<string, string>();
    const testStorage: Storage = {
      get length() { return storage.size; },
      clear: () => storage.clear(),
      getItem: (key) => storage.get(key) ?? null,
      key: (index) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    };

    saveTrackingProfile({
      unit: "  Test Unit  ",
      name: "  SGT Smith  ",
      email: "  smith@example.com  ",
    }, testStorage);

    expect(loadSavedTrackingProfile(testStorage)).toEqual({
      unit: "Test Unit",
      name: "SGT Smith",
      email: "smith@example.com",
    });
  });

  it("falls back to blanks when saved profile JSON is invalid", () => {
    const storage = new Map<string, string>([["opensentry-tracking-profile", "not-json"]]);
    const testStorage: Storage = {
      get length() { return storage.size; },
      clear: () => storage.clear(),
      getItem: (key) => storage.get(key) ?? null,
      key: (index) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    };

    expect(loadSavedTrackingProfile(testStorage)).toEqual({ unit: "", name: "", email: "" });
  });
});
