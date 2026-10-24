import type { ColorName } from "lojee-ui";
import type { ChangeKind, MemoryStatus, Origin } from "../domain";

export const STATUS_META: Record<MemoryStatus, { label: string; color: ColorName }> = {
  saved: { label: "Long Term Memory", color: "emerald" },
  pending: { label: "Waiting for review", color: "amber" },
  archived: { label: "Archived", color: "slate" },
};

export const ORIGIN_META: Record<Origin, { label: string; color: ColorName }> = {
  user: { label: "You", color: "blue" },
  agent: { label: "Agent", color: "violet" },
  import: { label: "Imported", color: "slate" },
  system: { label: "System", color: "slate" },
};

export const KIND_META: Record<ChangeKind, { label: string; color: ColorName }> = {
  create: { label: "New", color: "emerald" },
  update: { label: "Edited", color: "amber" },
  archive: { label: "Archived", color: "slate" },
  restore: { label: "Restored", color: "blue" },
};

/** Anything carrying a provenance (memories, relations are checked separately). */
export function isDemoMemory(m: { provenance: { origin: string } }): boolean {
  return m.provenance.origin === "demo";
}

export const typeLabel = (type: string): string => type.replace(/_/g, " ");

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.round((now - t) / 1000);
  if (s < 0) return formatDateTime(iso);
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [60, "m"],
    [24, "h"],
    [30, "d"],
    [12, "mo"],
  ];
  let v = s / 60;
  let label = "m";
  for (let i = 1; i < units.length && v >= units[i - 1][0]; i++) {
    v = v / units[i - 1][0];
    label = units[i][1];
  }
  return `${Math.floor(v)}${label} ago`;
}
