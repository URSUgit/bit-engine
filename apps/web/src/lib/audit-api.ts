/**
 * TypeScript client for the platform audit bot API (/api/v1/audit/...).
 * All calls are routed via the existing Next.js proxy → localhost:8001.
 */

const SIGNAL_BASE =
  process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";

export interface Finding {
  id: string;
  priority: string;
  category: string;
  title: string;
  detail: string;
  file: string;
  line: number;
  fix_hint: string;
}

export interface AuditReport {
  findings: Finding[];
  summary: Record<string, unknown>;
  checked_at: string;
}

export interface AuditReportMeta {
  id: number;
  checked_at: string;
  total: number;
  by_priority: Record<string, number>;
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${SIGNAL_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(`Audit API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const auditApi = {
  /** Run a full platform audit and return the new report. */
  runAudit(): Promise<AuditReport> {
    return apiFetch<AuditReport>("/api/v1/audit/run", { method: "POST" });
  },

  /** List past report metadata (no findings payload). */
  listReports(): Promise<AuditReportMeta[]> {
    return apiFetch<AuditReportMeta[]>("/api/v1/audit/reports");
  },

  /** Return the most recent full audit report, or null if none exists. */
  async latestReport(): Promise<AuditReport | null> {
    try {
      return await apiFetch<AuditReport>("/api/v1/audit/reports/latest");
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) return null;
      throw err;
    }
  },

  /** Return a specific audit report by numeric ID. */
  getReport(id: number): Promise<AuditReport> {
    return apiFetch<AuditReport>(`/api/v1/audit/reports/${id}`);
  },

  /** Write new file content to apply a fix (safety-checked on the server). */
  async applyFix(
    filePath: string,
    newContent: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await apiFetch<{ ok: boolean }>("/api/v1/audit/apply-fix", {
        method: "POST",
        body: JSON.stringify({ file_path: filePath, new_content: newContent }),
      });
      return res;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
