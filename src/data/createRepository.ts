import { loadStoredSession, getSessionToken, reportUnauthorized } from "../features/auth/session";
import { LocalRepository } from "./localRepository";
import { RemoteRepository } from "./remoteRepository";
import type { MemoryRepository } from "./repository";
import { getServerUrl } from "./serverSettings";

/** The server repository: acts as the signed-in user (session Bearer); any 401 clears the session. */
export function createRemoteRepository(baseUrl: string = getServerUrl()): RemoteRepository {
  return new RemoteRepository({ baseUrl, getToken: getSessionToken, onUnauthorized: reportUnauthorized });
}

/**
 * The store's initial repository before anyone is signed in: RemoteRepository when a login session is stored in this browser,
 * otherwise LocalRepository. Signing in always rebinds the workspace to createRemoteRepository() (see AuthContext).
 */
export function createRepository(hasSession: boolean = loadStoredSession() !== null): MemoryRepository {
  return hasSession ? createRemoteRepository() : new LocalRepository();
}

export const isRemote = (repo: MemoryRepository): repo is RemoteRepository => repo instanceof RemoteRepository;
