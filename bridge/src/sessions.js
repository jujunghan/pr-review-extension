import { randomUUID } from 'node:crypto';

export function createSessionStore() {
  const map = new Map();

  return {
    getOrCreate(prUrl) {
      if (typeof prUrl !== 'string' || prUrl === '') {
        throw new TypeError(`prUrl must be a non-empty string, got: ${String(prUrl)}`);
      }
      let id = map.get(prUrl);
      if (!id) {
        id = randomUUID();
        map.set(prUrl, id);
      }
      return id;
    },
    has(prUrl) {
      return map.has(prUrl);
    },
    clear(prUrl) {
      map.delete(prUrl);
    },
  };
}
