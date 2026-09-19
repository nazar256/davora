import { describe, expect, it } from "vitest";

import { buildUploadPartialFailureMessage, buildUploadPlan, buildUploadSuccessMessage, type UploadCandidate } from "./model";

function file(name: string, webkitRelativePath?: string): UploadCandidate {
  return { name, size: 5, type: "text/plain", ...(webkitRelativePath ? { webkitRelativePath } : {}) };
}

describe("buildUploadPlan", () => {
  it("snapshots flat files in input order without folders", () => {
    const plan = buildUploadPlan("Projects", [file("a.txt"), file("b.txt")]);

    expect(plan.basePath).toBe("Projects");
    expect(plan.folders).toEqual([]);
    expect(plan.files.map((item) => [item.index, item.destinationPath])).toEqual([
      [0, "Projects/a.txt"],
      [1, "Projects/b.txt"]
    ]);
  });

  it("deduplicates first-seen folders parent-before-child across multiple roots", () => {
    const plan = buildUploadPlan("Archive", [
      file("one.txt", "RootA/deep/one.txt"),
      file("two.txt", "RootB/two.txt"),
      file("three.txt", "RootA/deep/three.txt")
    ]);

    expect(plan.directoryRoots).toEqual(["RootA", "RootB"]);
    expect(plan.folders.map((folder) => folder.path)).toEqual([
      "Archive/RootA",
      "Archive/RootA/deep",
      "Archive/RootB"
    ]);
    expect(plan.files.map((item) => item.destinationPath)).toEqual([
      "Archive/RootA/deep/one.txt",
      "Archive/RootB/two.txt",
      "Archive/RootA/deep/three.txt"
    ]);
  });

  it("keeps duplicate destinations as distinct ordered work items", () => {
    const first = file("same.txt");
    const second = file("same.txt");

    const plan = buildUploadPlan("", [first, second]);

    expect(plan.files.map((item) => [item.index, item.destinationPath])).toEqual([[0, "same.txt"], [1, "same.txt"]]);
    expect(plan.files[0]?.file).toBe(first);
    expect(plan.files[1]?.file).toBe(second);
  });

  it("returns immutable snapshots independent of the input array", () => {
    const files = [file("a.txt")];
    const plan = buildUploadPlan("", files);
    files.push(file("b.txt"));

    expect(plan.files.map((item) => item.destinationPath)).toEqual(["a.txt"]);
    expect(Object.isFrozen(plan.files)).toBe(true);
    expect(Object.isFrozen(plan.folders)).toBe(true);
    expect(Object.isFrozen(plan.directoryRoots)).toBe(true);
  });

  it.each([
    ["../bad", [file("a.txt")]],
    ["", [file("../a.txt")]],
    ["", [file("a/b.txt")]],
    ["", [file("a.txt", "folder/../a.txt")]]
  ])("rejects noncanonical base paths, names, and relative paths", (basePath, files) => {
    expect(() => buildUploadPlan(basePath, files)).toThrow();
  });
});

describe("upload presentation messages", () => {
  it("builds picker and drop success messages", () => {
    expect(buildUploadSuccessMessage(2, 0, "/Projects", "picker")).toBe("Uploaded 2 files into /Projects");
    expect(buildUploadSuccessMessage(1, 2, "/Projects", "drop")).toBe("Uploaded 1 file from 2 folders into /Projects via drag and drop");
  });

  it("builds partial failure messages with pluralization", () => {
    expect(buildUploadPartialFailureMessage(1, 3, "/Projects")).toBe("Upload stopped after 1 file of 3 into /Projects");
  });
});
