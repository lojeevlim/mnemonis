import { DomainError, type DomainContext } from "./context";
import { assertActor, LIMITS } from "./limits";
import { getProject, RESERVED_PROJECT_NAMES, sha256Hex } from "./projects";
import { normalizeTitle } from "./titlePrefix";
import type { Actor, Mutation, Organization, Project, WorkspaceState } from "./types";
import { assertSafeId, freshId, safeGet } from "./util";

const invalid = (msg: string) => new DomainError("invalid_input", msg);
const tooLarge = (msg: string) => new DomainError("too_large", msg);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const FORMAT_CHARS = /\p{Cf}/u;

/** Deterministic id of an organization derived from its key: "org_" + first 16 hex chars of sha256(key). */
export const organizationIdForKey = (key: string): string => `org_${sha256Hex(key).slice(0, 16)}`;

/** An organization name: same rules as a project name (1-100 chars, NFC, no control / format characters, not reserved). */
export function checkOrganizationName(raw: unknown): string {
  if (typeof raw !== "string") throw invalid("organization name must be a string");
  if (FORMAT_CHARS.test(raw)) throw invalid("organization name must not contain invisible formatting characters");
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name) throw invalid("organization name must not be empty");
  if (name.length > LIMITS.organizationName) throw tooLarge(`Organization name is too long (max ${LIMITS.organizationName} characters)`);
  if (CONTROL_CHARS.test(raw)) throw invalid("organization name must not contain control characters");
  if (RESERVED_PROJECT_NAMES.has(normalizeTitle(name))) throw invalid(`organization name is reserved: ${name}`);
  return name;
}

/** `organization` only makes sense together with `project` (it says where a NEW project belongs). */
export function assertOrganizationWithProject(organization: unknown, project: unknown): void {
  if (organization !== undefined && project === undefined) throw invalid("organization requires project");
}

// ---- lookups ------------------------------------------------------------------------------------------------------

const organizationList = (state: WorkspaceState): Organization[] => Object.values(state.organizations);

const oldestFirst = (a: Organization, b: Organization): number =>
  a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1;

export function getOrganization(state: WorkspaceState, id: string | null | undefined): Organization | undefined {
  return safeGet(state.organizations, id);
}

/** Organizations, oldest first. */
export const listOrganizations = (state: WorkspaceState): Organization[] => organizationList(state).sort(oldestFirst);

/** The organization whose key equals `key` (a normalised key); the oldest on a (corrupt) tie. */
export function findOrganizationByKey(state: WorkspaceState, key: string): Organization | undefined {
  return organizationList(state).filter((o) => o.key === key).sort(oldestFirst)[0];
}

/** Projects that belong to `organizationId`. */
export const projectsOfOrganization = (state: WorkspaceState, organizationId: string): Project[] =>
  Object.values(state.projects).filter((p) => p.organizationId === organizationId);

// ---- user-only maintenance ----------------------------------------------------------------------------------------

function requireUser(actor: Actor): void {
  assertActor(actor);
  if (actor.kind !== "user") throw new DomainError("forbidden", "Only a user can change organizations");
}

function requireOrganization(state: WorkspaceState, id: string): Organization {
  const o = getOrganization(state, id);
  if (!o) throw new DomainError("organization_not_found", `Organization not found: ${id}`);
  return o;
}

function insertOrganization(state: WorkspaceState, ctx: DomainContext, name: string, actor: Actor): { state: WorkspaceState; organization: Organization } {
  const key = normalizeTitle(name);
  if (findOrganizationByKey(state, key)) throw new DomainError("duplicate_organization", `Organization already exists: ${name}`);
  const all = organizationList(state);
  if (all.length >= LIMITS.maxOrganizations) throw tooLarge(`Too many organizations (max ${LIMITS.maxOrganizations})`);
  const isAgent = actor.kind === "agent";
  if (isAgent && all.filter((o) => o.autoCreated && !o.confirmed).length >= LIMITS.maxAutoOrganizations) {
    throw tooLarge(`Too many unconfirmed organizations created by agents (max ${LIMITS.maxAutoOrganizations}); a user must review them first`);
  }
  const organization: Organization = {
    id: freshId(ctx, "org", (x) => Object.hasOwn(state.organizations, x)),
    key,
    name,
    createdAt: ctx.now(),
    createdBy: actor.name,
    autoCreated: isAgent,
    confirmed: !isAgent,
  };
  assertSafeId(organization.id, "organization");
  return { state: { ...state, organizations: { ...state.organizations, [organization.id]: organization } }, organization };
}

/** User only. Creates a confirmed organization. "duplicate_organization" when the name is taken, "too_large" over the cap. */
export function createOrganization(state: WorkspaceState, ctx: DomainContext, args: { name: string; actor: Actor }): Mutation<Organization> {
  requireUser(args.actor);
  const name = checkOrganizationName(args.name);
  const r = insertOrganization(state, ctx, name, args.actor);
  return { state: r.state, value: r.organization };
}

/** User only. Renames an organization (id and projects stay); the new name must not be another organization's. */
export function renameOrganization(state: WorkspaceState, args: { id: string; name: string; actor: Actor }): Mutation<Organization> {
  requireUser(args.actor);
  const o = requireOrganization(state, args.id);
  const name = checkOrganizationName(args.name);
  const key = normalizeTitle(name);
  const clash = findOrganizationByKey(state, key);
  if (clash && clash.id !== o.id) throw new DomainError("duplicate_organization", `Organization already exists: ${name}`);
  const next: Organization = { ...o, name, key, confirmed: true };
  return { state: { ...state, organizations: { ...state.organizations, [o.id]: next } }, value: next };
}

/** User only. Deletes an organization; its projects are kept and simply lose the link. */
export function deleteOrganization(state: WorkspaceState, args: { id: string; actor: Actor }): Mutation {
  requireUser(args.actor);
  const o = requireOrganization(state, args.id);
  const organizations = { ...state.organizations };
  delete organizations[o.id];
  const projects = { ...state.projects };
  for (const p of Object.values(projects)) if (p.organizationId === o.id) projects[p.id] = { ...p, organizationId: null };
  return { state: { ...state, organizations, projects }, value: undefined };
}

/** User only. Puts a project into an organization (null = none). Assigning acknowledges an unconfirmed organization. */
export function assignProjectOrganization(
  state: WorkspaceState,
  args: { projectId: string; organizationId: string | null; actor: Actor },
): Mutation<Project> {
  requireUser(args.actor);
  const p = getProject(state, args.projectId);
  if (!p) throw new DomainError("project_not_found", `Project not found: ${args.projectId}`);
  if (args.organizationId !== null) {
    if (typeof args.organizationId !== "string") throw invalid("organizationId must be a string or null");
    requireOrganization(state, args.organizationId);
  }
  const next: Project = { ...p, organizationId: args.organizationId };
  const assigned = { ...state, projects: { ...state.projects, [p.id]: next } };
  return { state: confirmOrganizationById(assigned, args.organizationId), value: next };
}

/** User only, idempotent: marks an organization as reviewed. */
export function confirmOrganization(state: WorkspaceState, args: { id: string; actor: Actor }): Mutation<Organization> {
  requireUser(args.actor);
  const o = requireOrganization(state, args.id);
  const next = confirmOrganizationById(state, o.id);
  return { state: next, value: getOrganization(next, o.id) as Organization };
}

/** Confirms `organizationId` when it exists and is unconfirmed; the same state object otherwise. */
export function confirmOrganizationById(state: WorkspaceState, organizationId: string | null | undefined): WorkspaceState {
  const o = getOrganization(state, organizationId);
  if (!o || o.confirmed) return state;
  return { ...state, organizations: { ...state.organizations, [o.id]: { ...o, confirmed: true } } };
}

// ---- cleanup ------------------------------------------------------------------------------------------------------

/**
 * System cleanup, pure and idempotent: removes every organization that an agent created, nobody has confirmed and
 * no project references. Run in the same transition that prunes projects, so an agent cannot leave junk behind to
 * exhaust LIMITS.maxOrganizations. Confirmed / user organizations are never touched. Same state object when
 * nothing changes. Linear in the number of projects + organizations.
 */
export function pruneEmptyAutoOrganizations(state: WorkspaceState): WorkspaceState {
  const candidates = organizationList(state).filter((o) => o.autoCreated && !o.confirmed);
  if (candidates.length === 0) return state;
  const used = new Set<string>();
  for (const p of Object.values(state.projects)) if (p.organizationId !== null) used.add(p.organizationId);
  const doomed = candidates.filter((o) => !used.has(o.id));
  if (doomed.length === 0) return state;
  const organizations = { ...state.organizations };
  for (const o of doomed) delete organizations[o.id];
  return { ...state, organizations };
}

// ---- agent input --------------------------------------------------------------------------------------------------

/**
 * Applies the optional `organization` name of a memory write to the project it resolved to. Only a project that was
 * just created by this write, or an existing UNCONFIRMED agent-created project that has no organization yet, is
 * linked; an existing confirmed / user project, or one that already has an organization, is never changed (the field
 * is silently ignored). The organization is reused by key (case-insensitive); otherwise it is created (agents:
 * autoCreated + unconfirmed, subject to the caps -> "too_large"). The name is validated even when ignored.
 */
export function applyOrganizationInput(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { organization: unknown; projectId: string | null | undefined; projectCreated: boolean; actor: Actor },
): WorkspaceState {
  if (args.organization === undefined) return state;
  const name = checkOrganizationName(args.organization);
  const p = getProject(state, args.projectId);
  if (!p) return state;
  const hasOrganization = p.organizationId !== null && !!getOrganization(state, p.organizationId);
  if (hasOrganization || !(args.projectCreated || (p.autoCreated && !p.confirmed))) return state;
  let next = state;
  let org = findOrganizationByKey(next, normalizeTitle(name));
  if (!org) {
    const r = insertOrganization(next, ctx, name, args.actor);
    next = r.state;
    org = r.organization;
  }
  const linked = { ...next, projects: { ...next.projects, [p.id]: { ...p, organizationId: org.id } } };
  return args.actor.kind === "user" ? confirmOrganizationById(linked, org.id) : linked;
}
