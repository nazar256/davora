import { describe, expect, it } from "vitest";

import { buildAccount } from "../../../test/accounts";
import {
  REMOVE_CONFIRMATION_MISMATCH_ERROR,
  buildRemoveDegradedStatus,
  buildRemoveSuccessStatus,
  validateRemoveConfirmation
} from "./model";

describe("remove account model", () => {
  const target = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace" });

  it("blocks confirmation mismatches", () => {
    expect(validateRemoveConfirmation("wrong label", target)).toEqual({
      kind: "invalid",
      message: REMOVE_CONFIRMATION_MISMATCH_ERROR
    });
  });

  it("accepts an exact trimmed confirmation match", () => {
    expect(validateRemoveConfirmation(" Alpha workspace ", target)).toEqual({ kind: "valid" });
  });

  it("rejects remove attempts without a target", () => {
    expect(validateRemoveConfirmation("Alpha workspace", undefined)).toEqual({
      kind: "invalid",
      message: REMOVE_CONFIRMATION_MISMATCH_ERROR
    });
  });

  it("builds success and degraded status messages", () => {
    expect(buildRemoveSuccessStatus("Alpha workspace")).toBe("Removed account Alpha workspace");
    expect(buildRemoveDegradedStatus("Alpha workspace")).toBe("Removed account Alpha workspace from browser state.");
  });
});
