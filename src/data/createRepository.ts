import { LocalRepository } from "./localRepository";
import { RemoteRepository } from "./remoteRepository";
import type { MemoryRepository } from "./repository";
import { loadServerSettings, type ServerSettings } from "./serverSettings";

export function createRemoteRepository(s: ServerSettings): RemoteRepository {
  return new RemoteRepository({ baseUrl: s.url, token: s.token });
}

/** RemoteRepository when server settings (URL + token) are stored in this browser, otherwise LocalRepository. */
export function createRepository(settings: ServerSettings | null = loadServerSettings()): MemoryRepository {
  return settings ? createRemoteRepository(settings) : new LocalRepository();
}

export const isRemote = (repo: MemoryRepository): repo is RemoteRepository => repo instanceof RemoteRepository;
