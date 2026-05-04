import { describe, expect, it } from "bun:test";
import { defaultEditor, defaultShellRunner, IS_WIN } from "./platform.ts";

describe("defaultEditor", () => {
  it("无 EDITOR / VISUAL 时按平台 fallback", () => {
    const orig = { EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };
    delete process.env.EDITOR;
    delete process.env.VISUAL;
    try {
      expect(defaultEditor()).toBe(IS_WIN ? "notepad" : "vi");
    } finally {
      if (orig.EDITOR !== undefined) process.env.EDITOR = orig.EDITOR;
      if (orig.VISUAL !== undefined) process.env.VISUAL = orig.VISUAL;
    }
  });

  it("EDITOR 优先于 VISUAL 与 fallback", () => {
    const orig = { EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };
    process.env.EDITOR = "code";
    process.env.VISUAL = "subl";
    try {
      expect(defaultEditor()).toBe("code");
    } finally {
      if (orig.EDITOR !== undefined) process.env.EDITOR = orig.EDITOR;
      else delete process.env.EDITOR;
      if (orig.VISUAL !== undefined) process.env.VISUAL = orig.VISUAL;
      else delete process.env.VISUAL;
    }
  });

  it("VISUAL 在 EDITOR 缺失时被采用", () => {
    const orig = { EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };
    delete process.env.EDITOR;
    process.env.VISUAL = "nano";
    try {
      expect(defaultEditor()).toBe("nano");
    } finally {
      if (orig.EDITOR !== undefined) process.env.EDITOR = orig.EDITOR;
      if (orig.VISUAL !== undefined) process.env.VISUAL = orig.VISUAL;
      else delete process.env.VISUAL;
    }
  });
});

describe("defaultShellRunner", () => {
  it("当前平台返回正确的 cmd + args 形态", () => {
    const runner = defaultShellRunner();
    if (IS_WIN) {
      expect(runner.cmd).toBe("powershell");
      expect(runner.kind).toBe("powershell");
      expect(runner.args("echo hi")).toEqual(["-NoProfile", "-Command", "echo hi"]);
    } else {
      expect(runner.cmd).toBe("bash");
      expect(runner.kind).toBe("bash");
      expect(runner.args("echo hi")).toEqual(["-lc", "echo hi"]);
    }
  });

  it("args 是函数，能为不同 script 各产 args", () => {
    const runner = defaultShellRunner();
    const a = runner.args("echo a");
    const b = runner.args("echo b");
    expect(a).not.toEqual(b);
    expect(a[a.length - 1]).toBe("echo a");
    expect(b[b.length - 1]).toBe("echo b");
  });
});
