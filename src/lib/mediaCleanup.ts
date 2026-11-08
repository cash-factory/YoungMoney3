export interface MediaCleanupAdapter {
  listSupabasePage: (ownerId: string, offset: number, limit: number) => Promise<{ paths: string[]; folders?: string[]; hasMore: boolean }>;
  removeSupabase: (paths: string[]) => Promise<void>;
  listR2Page: (prefix: string, cursor?: string) => Promise<{ keys: string[]; truncated: boolean; cursor?: string }>;
  deleteR2: (keys: string[]) => Promise<void>;
}

const deleteBatchSize = 100;
const listPageSize = 1000;

function assertOwnedPath(path: string, ownerId: string): void {
  if (!path.startsWith(`${ownerId}/`) || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error('Media cleanup returned a path outside the target account.');
  }
}

async function deleteBatches(paths: string[], remove: (batch: string[]) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += deleteBatchSize) {
    await remove(paths.slice(offset, offset + deleteBatchSize));
  }
}

export async function deleteOwnedMedia(ownerId: string, adapter: MediaCleanupAdapter): Promise<void> {
  if (!ownerId || ownerId.includes('/') || ownerId.includes('\\')) throw new Error('Invalid media owner ID.');
  const supabasePaths: string[] = [];
  const folders = [ownerId];
  for (const folder of folders) {
    let offset = 0;
    while (true) {
      const page = await adapter.listSupabasePage(folder, offset, listPageSize);
      const children = page.folders ?? [];
      for (const path of [...page.paths, ...children]) {
        assertOwnedPath(path, ownerId);
        if (path.slice(0, path.lastIndexOf('/')) !== folder) throw new Error('Unexpected storage directory.');
      }
      supabasePaths.push(...page.paths);
      folders.push(...children);
      if (!page.hasMore) break;
      const count = children.length + page.paths.length;
      if (!count) throw new Error('Supabase media listing reported more results without returning any paths.');
      offset += count;
    }
  }
  await deleteBatches(supabasePaths, adapter.removeSupabase);

  let cursor: string | undefined;
  let truncated = true;
  while (truncated) {
    const page = await adapter.listR2Page(`${ownerId}/`, cursor);
    page.keys.forEach(path => assertOwnedPath(path, ownerId));
    await deleteBatches(page.keys, adapter.deleteR2);
    cursor = page.cursor;
    if (page.truncated && !cursor) throw new Error('R2 media listing did not provide a continuation cursor.');
    truncated = page.truncated;
  }
}
