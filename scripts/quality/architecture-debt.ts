import type { ArchitectureViolation } from "./architecture";
import type { DebtFinding } from "./debt-baseline";

export const architectureFinding = (violation: ArchitectureViolation): DebtFinding => ({
  ruleId: violation.ruleId,
  path: violation.path,
  nodeType: "File",
  messageId: "architectureViolation",
  source: violation.detail
});
