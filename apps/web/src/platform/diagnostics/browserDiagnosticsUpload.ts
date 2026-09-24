import { diagnosticReportEndpoint, type DiagnosticReportReceipt } from "@davora/shared";

import { request } from "../../lib/api";

const MAX_REPORT_BYTES = 3 * 1024 * 1024;

const digestHex = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await new Response(blob).arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const createBrowserDiagnosticsUpload = () => ({
  createReportId: () => crypto.randomUUID(),
  async upload(input: {
    readonly reportId: string;
    readonly blob: Blob;
    readonly generatedAt: string;
    readonly diagnosticsSchema: number;
    readonly appBuild: string;
    readonly token: string;
  }): Promise<DiagnosticReportReceipt> {
    if (input.blob.size > MAX_REPORT_BYTES) {
      throw new Error("DiagnosticReportTooLarge");
    }
    const sha256 = await digestHex(input.blob);
    return request<DiagnosticReportReceipt>(diagnosticReportEndpoint.path, {
      method: diagnosticReportEndpoint.method,
      body: input.blob,
      headers: {
        "content-type": "application/zip",
        "x-davora-report-id": input.reportId,
        "x-davora-report-sha256": sha256,
        "x-davora-report-generated-at": input.generatedAt,
        "x-davora-diagnostics-schema": String(input.diagnosticsSchema),
        "x-davora-web-build": input.appBuild
      }
    }, input.token, diagnosticReportEndpoint.successSchema);
  }
});
