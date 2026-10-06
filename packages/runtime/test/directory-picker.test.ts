import { describe, expect, it } from "vitest";
import {
  directoryDialogCommands,
  pickDirectory,
} from "../src/directory-picker.js";

describe("directoryDialogCommands", () => {
  it("uses a system folder dialog on each supported platform", () => {
    expect(
      directoryDialogCommands("linux").map((dialog) => dialog.command),
    ).toEqual(["zenity", "kdialog"]);
    expect(directoryDialogCommands("darwin")[0]?.command).toBe("osascript");
    expect(directoryDialogCommands("win32")[0]?.command).toBe("powershell.exe");
    expect(directoryDialogCommands("aix")).toEqual([]);
  });
});

describe("pickDirectory", () => {
  it("returns the chosen path and treats cancel as no path", async () => {
    const chosen = await pickDirectory(
      async () => ({ code: 0, stdout: "/var/mocks\n" }),
      "linux",
    );
    expect(chosen).toEqual({ ok: true, path: "/var/mocks" });

    const cancelled = await pickDirectory(
      async () => ({ code: 1, stdout: "" }),
      "linux",
    );
    expect(cancelled).toEqual({ ok: true, path: null });
  });

  it("tries the next dialog when the first tool is missing", async () => {
    const calls: string[] = [];
    const picked = await pickDirectory(async (command) => {
      calls.push(command);
      if (command === "zenity")
        return { code: null, stdout: "", errorCode: "ENOENT" };
      return { code: 0, stdout: "/var/mocks" };
    }, "linux");
    expect(calls).toEqual(["zenity", "kdialog"]);
    expect(picked).toEqual({ ok: true, path: "/var/mocks" });
  });

  it("fails closed when no dialog tool exists", async () => {
    const missing = await pickDirectory(
      async () => ({ code: null, stdout: "", errorCode: "ENOENT" }),
      "linux",
    );
    expect(missing).toEqual({ ok: false, code: "runtime.picker-unavailable" });
    const unsupported = await pickDirectory(
      async () => ({ code: 0, stdout: "/tmp" }),
      "aix",
    );
    expect(unsupported).toEqual({
      ok: false,
      code: "runtime.picker-unavailable",
    });
  });
});
