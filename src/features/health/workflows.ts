/**
 * Memory Health checks (Organize, Review). Framework-free, rule-based and LLM-free: plain
 * heuristics over the current memories that emit reviewable PROPOSALS. Nothing here mutates
 * state; applying a proposal is done separately and only ever sends it to the Inbox.
 */
import type { Memory, Relation } from "../../domain";

export type CheckName = "organize" | "review";

export type ProposalKind =
  | "duplicate"
  | "near-duplicate"
  | "missing-tags"
  | "missing-collection"
  | "empty-content"
  | "missing-source"
  | "isolated"
  | "stale"
  | "contradiction"
  | "missing-provenance";

export type Confidence = "high" | "medium" | "low";

/** A single change an Apply would perform (sent to the Inbox; links are additive relations). */
export type ProposalAction =
  | { kind: "add-tag"; memoryId: string; tag: string }
  | { kind: "set-collection"; memoryId: string; collectionId: string }
  | { kind: "archive"; memoryId: string }
  | { kind: "link"; fromId: string; toId: string; label: string };

export interface Proposal {
  /** Deterministic: the same finding gets the same id on every run. */
  id: string;
  check: CheckName;
  kind: ProposalKind;
  finding: string;
  evidence: string[];
  confidence: Confidence;
  /** Memories the finding is about (first one is the primary). */
  memoryIds: string[];
  /** null = nothing can be applied automatically; needs a manual edit. */
  action: ProposalAction | null;
  /** Human-readable description of what Apply does (or what to do manually). */
  suggestion: string;
  /** True for heuristics that are guesses and must be read critically. */
  heuristic?: boolean;
}

export interface WorkflowInput {
  memories: Memory[];
  relations: Relation[];
  collections: { id: string; name: string }[];
  /** epoch ms */
  now: number;
}

export interface OrganizeOptions {
  /** Similarity (0..1) at or above which two memories are flagged. */
  duplicateThreshold: number;
}
export interface ReviewOptions {
  staleDays: number;
}

export const DEFAULT_DUPLICATE_THRESHOLD = 0.6;
export const DEFAULT_STALE_DAYS = 90;
export const STALE_TAG = "needs-review";

// ---- text helpers ---------------------------------------------------------

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "you", "your", "not",
  "but", "have", "has", "had", "can", "will", "all", "any", "its", "into", "than", "then", "them",
  "they", "our", "out", "use", "via", "per", "how", "why", "what", "when", "who",
]);

export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of normalizeTitle(s).split(" ")) {
    if (t.length >= 3 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Similarity of two memories in 0..1 (1 = identical normalized titles). */
export function similarity(a: Memory, b: Memory): number {
  const na = normalizeTitle(a.title);
  if (na && na === normalizeTitle(b.title)) return 1;
  const titleJ = jaccard(tokenize(a.title), tokenize(b.title));
  const ca = tokenize(a.content);
  const cb = tokenize(b.content);
  if (ca.size === 0 || cb.size === 0) return titleJ;
  return titleJ * 0.4 + jaccard(ca, cb) * 0.6;
}

const NEGATION = /\b(not|never|no longer|deprecated|don't|do not|doesn't|does not|isn't|is not|won't|cannot|can't)\b/i;
const NEGATION_WORDS = new Set(["not", "never", "longer", "deprecated", "don't", "doesn", "isn", "won", "cannot", "can"]);

const active = (ms: Memory[]) => ms.filter((m) => !m.archived);
const byId = (a: Memory, b: Memory) => a.id.localeCompare(b.id);
const quote = (m: Memory) => `“${m.title || "(untitled)"}”`;
const pairKey = (a: string, b: string) => (a < b ? `${a}+${b}` : `${b}+${a}`);

function connectedIds(relations: Relation[]): Set<string> {
  const s = new Set<string>();
  for (const r of relations) {
    s.add(r.fromId);
    s.add(r.toId);
  }
  return s;
}

function relatedPair(relations: Relation[], a: string, b: string, label?: string): boolean {
  return relations.some(
    (r) =>
      ((r.fromId === a && r.toId === b) || (r.fromId === b && r.toId === a)) && (label === undefined || r.label === label),
  );
}

/** Most similar other memory (>= min), ties broken by id for determinism. */
function mostSimilar(m: Memory, others: Memory[], min: number, filter: (o: Memory) => boolean = () => true) {
  let best: { memory: Memory; score: number } | null = null;
  for (const o of [...others].sort(byId)) {
    if (o.id === m.id || !filter(o)) continue;
    const score = similarity(m, o);
    if (score >= min && (!best || score > best.score)) best = { memory: o, score };
  }
  return best;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// ---- Organize ---------------------------------------------------------------

export function runOrganize(input: WorkflowInput, opts: OrganizeOptions): Proposal[] {
  const memories = active(input.memories).sort(byId);
  const { relations, collections } = input;
  const out: Proposal[] = [];

  // Duplicates / near-duplicates
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];
      const score = similarity(a, b);
      if (score < opts.duplicateThreshold) continue;
      const exact = score === 1;
      const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];
      const evidence = [
        exact ? "Titles are identical after normalizing case and punctuation." : `Token similarity ${pct(score)} (threshold ${pct(opts.duplicateThreshold)}).`,
        `${quote(a)} (updated ${a.updatedAt.slice(0, 10)})`,
        `${quote(b)} (updated ${b.updatedAt.slice(0, 10)})`,
      ];
      if (exact) {
        out.push({
          id: `organize:duplicate:${pairKey(a.id, b.id)}`,
          check: "organize",
          kind: "duplicate",
          finding: `Duplicate memories: ${quote(a)} and ${quote(b)}`,
          evidence,
          confidence: "high",
          memoryIds: [older.id, newer.id],
          action: { kind: "archive", memoryId: older.id },
          suggestion: `Archive the older copy ${quote(older)} (sent to the Inbox for your review).`,
        });
      } else if (!relatedPair(relations, a.id, b.id)) {
        out.push({
          id: `organize:near-duplicate:${pairKey(a.id, b.id)}`,
          check: "organize",
          kind: "near-duplicate",
          finding: `Near-duplicate memories: ${quote(a)} and ${quote(b)}`,
          evidence,
          confidence: score >= 0.8 ? "high" : "medium",
          memoryIds: [a.id, b.id],
          action: { kind: "link", fromId: a.id, toId: b.id, label: "similar to" },
          suggestion: `Link them as related ("similar to") so they can be reviewed together or combined by hand.`,
        });
      }
    }
  }

  // Missing metadata
  const withCollection = memories.filter((m) => m.collectionId && collections.some((c) => c.id === m.collectionId));
  for (const m of memories) {
    if (m.tags.length === 0) {
      const tag = m.type.replace(/_/g, "-");
      out.push({
        id: `organize:missing-tags:${m.id}`,
        check: "organize",
        kind: "missing-tags",
        finding: `${quote(m)} has no tags`,
        evidence: [`Type is “${m.type}”.`],
        confidence: "medium",
        memoryIds: [m.id],
        action: { kind: "add-tag", memoryId: m.id, tag },
        suggestion: `Add the tag “${tag}” (derived from its type).`,
      });
    }
    if (!m.collectionId) {
      const best = mostSimilar(m, withCollection, 0.1);
      const col = best && collections.find((c) => c.id === best.memory.collectionId);
      out.push({
        id: `organize:missing-collection:${m.id}`,
        check: "organize",
        kind: "missing-collection",
        finding: `${quote(m)} is not in a collection`,
        evidence: best && col ? [`Most similar memory ${quote(best.memory)} (${pct(best.score)}) is in “${col.name}”.`] : ["No similar memory in a collection to learn from."],
        confidence: best ? "low" : "medium",
        memoryIds: [m.id],
        action: best && col ? { kind: "set-collection", memoryId: m.id, collectionId: col.id } : null,
        suggestion: col ? `Move it into “${col.name}”.` : "Pick a collection manually.",
      });
    }
    if (m.content.trim() === "") {
      out.push({
        id: `organize:empty-content:${m.id}`,
        check: "organize",
        kind: "empty-content",
        finding: `${quote(m)} has no content`,
        evidence: ["The content is empty or whitespace."],
        confidence: "high",
        memoryIds: [m.id],
        action: null,
        suggestion: "Write some content, or archive the memory if it is no longer needed.",
      });
    }
    if (m.source.trim() === "") {
      out.push({
        id: `organize:missing-source:${m.id}`,
        check: "organize",
        kind: "missing-source",
        finding: `${quote(m)} has no source`,
        evidence: ["The source field is empty (it cannot be edited after creation)."],
        confidence: "high",
        memoryIds: [m.id],
        action: null,
        suggestion: "Note where this came from in the content so it can be verified later.",
      });
    }
  }

  // Organization: isolated memories
  const connected = connectedIds(relations);
  for (const m of memories) {
    if (connected.has(m.id)) continue;
    const best = mostSimilar(m, memories, 0.1);
    out.push({
      id: `organize:isolated:${m.id}`,
      check: "organize",
      kind: "isolated",
      finding: `${quote(m)} is isolated (no relations)`,
      evidence: best ? [`Most similar memory: ${quote(best.memory)} (${pct(best.score)}).`] : ["No similar memory found to link to."],
      confidence: best ? "low" : "medium",
      memoryIds: best ? [m.id, best.memory.id] : [m.id],
      action: best ? { kind: "link", fromId: m.id, toId: best.memory.id, label: "related to" } : null,
      suggestion: best ? `Link it to ${quote(best.memory)} as related.` : "Link it to a related memory from the Knowledge Graph.",
    });
  }

  return out;
}

// ---- Review ------------------------------------------------------------------

export function runReview(input: WorkflowInput, opts: ReviewOptions): Proposal[] {
  const memories = active(input.memories).sort(byId);
  const { relations, now } = input;
  const out: Proposal[] = [];
  const cutoff = now - opts.staleDays * 86_400_000;

  for (const m of memories) {
    const t = new Date(m.updatedAt).getTime();
    if (!Number.isNaN(t) && t < cutoff) {
      const days = Math.floor((now - t) / 86_400_000);
      out.push({
        id: `review:stale:${m.id}`,
        check: "review",
        kind: "stale",
        finding: `${quote(m)} may be stale`,
        evidence: [`Last updated ${m.updatedAt.slice(0, 10)} (${days} days ago; threshold ${opts.staleDays} days).`],
        confidence: "medium",
        memoryIds: [m.id],
        action: m.tags.includes(STALE_TAG) ? null : { kind: "add-tag", memoryId: m.id, tag: STALE_TAG },
        suggestion: m.tags.includes(STALE_TAG) ? "Already tagged; re-read and update or archive it." : `Tag it “${STALE_TAG}” so it surfaces in review.`,
      });
    }
    if (!m.provenance?.origin?.trim() || !m.provenance?.createdBy?.trim()) {
      out.push({
        id: `review:missing-provenance:${m.id}`,
        check: "review",
        kind: "missing-provenance",
        finding: `${quote(m)} has incomplete provenance`,
        evidence: [`origin: “${m.provenance?.origin ?? ""}”, created by: “${m.provenance?.createdBy ?? ""}”.`],
        confidence: "high",
        memoryIds: [m.id],
        action: null,
        suggestion: "Provenance is fixed at creation; verify the content manually before trusting it.",
      });
    }
  }

  // Possible contradictions (heuristic, low confidence)
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];
      const textA = `${a.title} ${a.content}`;
      const textB = `${b.title} ${b.content}`;
      const negA = NEGATION.test(textA);
      const negB = NEGATION.test(textB);
      if (negA === negB) continue;
      const sharedTags = a.tags.filter((t) => b.tags.includes(t));
      const titleJ = jaccard(tokenize(a.title), tokenize(b.title));
      if (sharedTags.length === 0 && titleJ < 0.3) continue;
      const strip = (s: string) => new Set([...tokenize(s)].filter((t) => !NEGATION_WORDS.has(t)));
      const topicJ = jaccard(strip(textA), strip(textB));
      if (topicJ < 0.2) continue;
      if (relatedPair(relations, a.id, b.id, "possible contradiction")) continue;
      const [neg, pos] = negA ? [a, b] : [b, a];
      out.push({
        id: `review:contradiction:${pairKey(a.id, b.id)}`,
        check: "review",
        kind: "contradiction",
        finding: `Possible contradiction between ${quote(a)} and ${quote(b)}`,
        evidence: [
          "Heuristic guess, low confidence: similar topic, but only one side uses a negation marker (not / never / no longer / deprecated ...).",
          sharedTags.length ? `Shared tags: ${sharedTags.join(", ")}.` : `Title similarity ${pct(titleJ)}.`,
          `Topic overlap ${pct(topicJ)}. Negated side: ${quote(neg)}; affirmative side: ${quote(pos)}.`,
        ],
        confidence: "low",
        heuristic: true,
        memoryIds: [a.id, b.id],
        action: { kind: "link", fromId: a.id, toId: b.id, label: "possible contradiction" },
        suggestion: "Link them as a possible contradiction so you can compare them, then edit one if they really disagree.",
      });
    }
  }

  return out;
}
