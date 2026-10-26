import { apiRequest } from "../../data/accountApi";

export interface McpToken {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreatedToken {
  id: string;
  /** The full secret. Returned once; never persist or log it. */
  token: string;
  prefix: string;
  label: string;
  createdAt: string;
  expiresAt: string | null;
}

export async function listTokens(): Promise<McpToken[]> {
  const r = await apiRequest<{ tokens?: McpToken[] }>("/api/tokens");
  return Array.isArray(r?.tokens) ? r.tokens : [];
}

export function createToken(label: string): Promise<CreatedToken> {
  return apiRequest<CreatedToken>("/api/tokens", { method: "POST", body: { label } });
}

export async function revokeToken(id: string): Promise<void> {
  await apiRequest(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Permanently deletes the record of a revoked or expired token (the server refuses an active one). */
export async function removeToken(id: string): Promise<void> {
  await apiRequest(`/api/tokens/${encodeURIComponent(id)}?permanent=1`, { method: "DELETE" });
}

export type TokenStatus = "Active" | "Revoked" | "Expired";

export function tokenStatus(t: Pick<McpToken, "revokedAt" | "expiresAt">, now = Date.now()): TokenStatus {
  if (t.revokedAt) return "Revoked";
  if (t.expiresAt && Date.parse(t.expiresAt) <= now) return "Expired";
  return "Active";
}
