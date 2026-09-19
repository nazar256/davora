import { describe, expect, it } from "vitest";

import { buildLocationHref, parseLocationSearch } from "./location";

describe("navigation location (NAV-01)", () => {
  it("builds URL search params from path and optional accountId", () => {
    expect(buildLocationHref("http://localhost/", "Projects", "alpha")).toBe(
      "http://localhost/?path=Projects&account=alpha"
    );
    expect(buildLocationHref("http://localhost/?theme=dark", "Projects", "alpha")).toBe(
      "http://localhost/?theme=dark&path=Projects&account=alpha"
    );
    expect(buildLocationHref("http://localhost/", "Projects")).toBe(
      "http://localhost/?path=Projects"
    );
  });

  it("clears a stale account param when path is set without accountId", () => {
    expect(buildLocationHref("http://localhost/?path=Old&account=alpha&theme=dark", "Projects")).toBe(
      "http://localhost/?path=Projects&theme=dark"
    );
    expect(buildLocationHref("http://localhost/?account=alpha", "Projects", "")).toBe(
      "http://localhost/?path=Projects"
    );
  });

  it("clears path and account params when path is empty", () => {
    expect(buildLocationHref("http://localhost/?path=Projects&account=alpha", "")).toBe(
      "http://localhost/"
    );
    expect(buildLocationHref("http://localhost/?path=Projects&account=alpha&theme=dark", "")).toBe(
      "http://localhost/?theme=dark"
    );
  });

  it("preserves origin, pathname, and hash", () => {
    expect(buildLocationHref("https://app.example/davora#panel", "Archive", "beta")).toBe(
      "https://app.example/davora?path=Archive&account=beta#panel"
    );
  });

  it("parses location search for path and optional accountId", () => {
    expect(parseLocationSearch("?path=Projects&account=alpha")).toEqual({
      path: "Projects",
      accountId: "alpha"
    });
    expect(parseLocationSearch("path=Projects")).toEqual({ path: "Projects" });
    expect(parseLocationSearch("")).toEqual({ path: "" });
    expect(parseLocationSearch("?theme=dark")).toEqual({ path: "" });
  });
});
