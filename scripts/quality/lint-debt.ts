import path from "node:path";

import type { DebtFinding } from "./debt-baseline";

interface LintMessageLike {
  ruleId: string | null;
  message: string;
  messageId?: string;
  nodeType?: string | null;
  severity: number;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

interface LintResultLike {
  filePath: string;
  source?: string;
  messages: readonly LintMessageLike[];
}

const normalizeSource = (source: string): string => source.replace(/\s+/g, " ").trim();

const sourceSlice = (source: string | undefined, message: LintMessageLike): string => {
  if (!source || !message.line || !message.column) {
    return "unknown";
  }

  const lines = source.split("\n");
  const startLine = message.line - 1;
  const endLine = (message.endLine ?? message.line) - 1;
  const startColumn = message.column - 1;
  const endColumn = message.endColumn ? message.endColumn - 1 : lines[startLine]?.length;

  if (startLine === endLine) {
    return normalizeSource(lines[startLine]?.slice(startColumn, endColumn) ?? "unknown");
  }

  return normalizeSource([
    lines[startLine]?.slice(startColumn),
    ...lines.slice(startLine + 1, endLine),
    lines[endLine]?.slice(0, endColumn)
  ].join("\n"));
};

export const lintMessagesToDebtFindings = (
  repoRoot: string,
  results: readonly LintResultLike[]
): DebtFinding[] => results.flatMap((result) => result.messages
  .filter((message) => message.severity === 1 && message.ruleId)
  .map((message) => ({
    ruleId: message.ruleId ?? "unknown",
    path: path.relative(repoRoot, result.filePath).replaceAll("\\", "/"),
    nodeType: message.nodeType ?? "unknown",
    messageId: message.messageId ?? message.message,
    source: sourceSlice(result.source, message)
  })));
