import { describe, expect, it } from "vitest";

import { categorizeApiRoute, createDiagnosticsRedactor } from "./redaction";

describe("diagnostics redactor", () => {
  it("aliases paths stably while preserving shape", () => {
    const redactor = createDiagnosticsRedactor();
    const first = redactor.path("Documents/Reports/report.pdf", "file");
    const repeat = redactor.path("Documents/Reports/report.pdf", "file");
    const other = redactor.path("Photos", "folder");

    expect(first.alias).toBe("path-1");
    expect(repeat.alias).toBe("path-1");
    expect(first.depth).toBe(3);
    expect(first.extension).toBe("pdf");
    expect(first.kind).toBe("file");
    expect(other.alias).toBe("path-2");
    expect(other.depth).toBe(1);
    expect(other.extension).toBeUndefined();
    expect(other.kind).toBe("folder");
  });

  it("never exposes raw path text in the alias", () => {
    const redactor = createDiagnosticsRedactor();
    const ref = redactor.path("Users/alice/secret-notes.txt", "file");
    expect(ref.alias).not.toContain("alice");
    expect(ref.alias).not.toContain("secret");
    expect(ref.extension).toBe("txt");
  });

  it("assigns independent alias sequences per prefix", () => {
    const redactor = createDiagnosticsRedactor();
    expect(redactor.alias("account", "acct-123")).toBe("account-1");
    expect(redactor.alias("account", "acct-456")).toBe("account-2");
    expect(redactor.alias("session", "acct-123")).toBe("session-1");
    expect(redactor.alias("account", "acct-123")).toBe("account-1");
    expect(redactor.alias("account", undefined)).toBeUndefined();
    expect(redactor.alias("account", "")).toBeUndefined();
  });

  it("reduces URLs to route templates without query, hash, or credentials", () => {
    const redactor = createDiagnosticsRedactor();
    expect(redactor.route("https://user:pass@cloud.example.com/api/files/list?path=/a/b&token=zzz#frag"))
      .toBe("/api/files/list");
    expect(redactor.route("/api/files/list?path=Documents")).toBe("/api/files/list");
    expect(redactor.route("https://example.com/a/b/c/d/e")).toBe("/a/b/c");
  });

  it("sanitizes error messages: URLs, tokens, and absolute personal paths", () => {
    const redactor = createDiagnosticsRedactor();
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
    const message = redactor.message(
      `GET https://cloud.example.com/api/files?path=/home/alice failed with token ${jwt} at "/home/alice/Documents"`
    );
    expect(message).not.toContain("cloud.example.com");
    expect(message).not.toContain("alice");
    expect(message).not.toContain(jwt);
    expect(message).toContain("<url>");
    expect(message).toContain("<redacted>");
    expect(message).toContain("<path:3>");
  });

  it("truncates long messages", () => {
    const redactor = createDiagnosticsRedactor();
    const message = redactor.message("word ".repeat(200));
    expect(message.length).toBeLessThanOrEqual(301);
    expect(message.endsWith("…")).toBe(true);
  });
});

describe("categorizeApiRoute", () => {
  it("maps API routes to privacy-safe categories", () => {
    expect(categorizeApiRoute("/api/health")).toBe("health");
    expect(categorizeApiRoute("/api/accounts/connect")).toBe("auth");
    expect(categorizeApiRoute("/api/session/refresh")).toBe("auth");
    expect(categorizeApiRoute("/api/preview/thumb")).toBe("preview");
    expect(categorizeApiRoute("/api/content/stream")).toBe("preview");
    expect(categorizeApiRoute("/api/download/file")).toBe("download");
    expect(categorizeApiRoute("/api/files/list")).toBe("files");
    expect(categorizeApiRoute("/metrics")).toBe("other");
  });
});
