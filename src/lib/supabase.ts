type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { message: string; status?:number } | null };
type QueryResult = { data: unknown; error: { message: string } | null; count?: number | null };

// Sessions are issued as same-origin HttpOnly cookies. Discard pre-migration credentials.
localStorage.removeItem('trade-journal-session');
const listeners = new Set<(event: string, session: unknown) => void>();

async function api(path: string, body?: unknown, method = 'POST'): Promise<Result> {
  try {
    const response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json() as Row;
    return { data: response.ok ? data : null, error: response.ok ? null : { message: String(data.error || 'Request failed.'),status:response.status } };
  } catch {
    return { data: null, error: { message: 'Could not reach the workspace service.' } };
  }
}

async function mediaApi(path: string, method = 'GET', body?: BodyInit, contentType?: string) {
  try {
    const response = await fetch(path, {
      method,
      headers: { ...(contentType ? { 'content-type': contentType } : {}) },
      body,
    });
    if (!response.ok) {
      const result = await response.json() as Row;
      return { data: null, error: { message: String(result.error || 'Media request failed.') } };
    }
    return { data: response, error: null };
  } catch {
    return { data: null, error: { message: 'Could not reach the workspace service.' } };
  }
}

class Query {
  private filters: Record<string, unknown> = {};
  private membershipFilters: Record<string, unknown[]> = {};
  private operation: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private head = false;
  private one = false;
  private maybe = false;
  private wantedOrder: { column: string; ascending?: boolean } | undefined;
  private countRequested = false;
  private rowLimit: number | undefined;
  private orFilter: string | undefined;

  constructor(private table: string) {}
  select(columns = '*', options?: { count?: string; head?: boolean }) { void columns; this.head=!!options?.head; this.countRequested = !!options?.count; return this; }
  insert(value: Row | Row[]) { this.operation = 'insert'; this.payload = value; return this; }
  upsert(value: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) { if(options && (options.ignoreDuplicates!==true || (options.onConflict!=='id' && !(this.table==='instrument_favorites' && options.onConflict==='user_id,instrument_id')))) throw new Error('Unsupported restore conflict policy.'); this.operation = 'upsert'; this.payload = value; return this; }
  update(value: Row) { this.operation = 'update'; this.payload = value; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(key: string, value: unknown) { this.filters[key] = value; return this; }
  is(key: string, value: unknown) { this.filters[key] = value; return this; }
  in(key: string, values: unknown[]) { this.membershipFilters[key] = values; return this; }
  or(value: string) { this.orFilter = value; return this; }
  order(column: string, options?: { ascending?: boolean }) { this.wantedOrder = { column, ...options }; return this; }
  limit(count: number) { this.rowLimit = count; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.maybe = true; return this; }
  then<TResult1 = unknown, TResult2 = never>(
    resolve?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.run().then(resolve, reject);
  }

  private async run(): Promise<QueryResult> {
    if (this.table === 'profiles') {
      if (this.operation === 'select') {
        const result = await api('/api/me', undefined, 'GET');
        const user = result.data?.user as Row | undefined;
        return { data: this.one || this.maybe ? user || null : user ? [user] : [], error: result.error, count: user ? 1 : 0 };
      }
      if (this.operation === 'update' || this.operation === 'insert' || this.operation === 'upsert') {
        const profile = Array.isArray(this.payload) ? this.payload[0] : this.payload;
        const result = await api('/api/auth/profile', profile);
        return { data: result.data?.user ? [result.data.user as Row] : [], error: result.error };
      }
    }
    const query = {
      action: this.operation,
      table: this.table,
      id: this.filters.id,
      payload: this.payload,
      filters: Object.fromEntries(Object.entries(this.filters).filter(([key]) => this.operation === 'select' || key !== 'id')),
      membershipFilters: this.membershipFilters,
      or: this.orFilter,
      order: this.wantedOrder,
      limit: this.rowLimit, head:this.head,
    };
    const result = await api('/api/data', query);
    if (this.operation==='select' && result.data && Array.isArray(result.data.data)) {
      let page=result.data.nextPage;
      while(typeof page==='number'){
        const more=await api('/api/data',{...query,page});
        if(more.error) return {data:null,error:more.error};
        if(!Array.isArray(more.data?.data)) return {data:null,error:{message:'Incomplete data page.'}};
        result.data.data.push(...more.data.data);
        const next=more.data.nextPage;
        if(typeof next==='number' && next<=page) return {data:null,error:{message:'Data pagination stalled.'}};
        page=next;
      }
    }
    if (result.error) return { data: null, error: result.error };
    const value = result.data?.data;
    const rows = Array.isArray(value) ? value as Row[] : value ? [value as Row] : [];
    if (this.one && rows.length !== 1) return { data: null, error: { message: 'Expected one record.' } };
    const data = this.one || this.maybe ? rows[0] || null : rows;
    return { data, error: null, count: this.countRequested ? Number(result.data?.count ?? rows.length) : null };
  }
}

const emit = (event: string, session: unknown) => listeners.forEach(listener => listener(event, session));
const sessionFrom = (user: Row) => ({ user });

// The app's data-access shim intentionally mirrors the dynamically shaped Supabase client API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = {
  from: (table: string) => new Query(table),
  auth: {
    async getSession() {

      const result = await api('/api/me', undefined, 'GET');
      if (result.error || !result.data?.user) return { data:{session:null}, error:result.error?.status===401 ? null : result.error };
      return { data: { session: sessionFrom(result.data.user as Row) } };
    },
    async getUser() {
      const result = await api('/api/me', undefined, 'GET');
      return { data: { user: result.data?.user || null }, error: result.error };
    },
    onAuthStateChange(callback: (event: string, session: unknown) => void) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => { listeners.delete(callback); } } } };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const result = await api('/api/auth/signin', { email, password });
      if (result.error || !result.data) return { error: result.error };
      const session = sessionFrom(result.data.user as Row);
      emit('SIGNED_IN', session);
      return { error: null, data: { session, user: result.data.user } };
    },
    async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { display_name?: string; pilot_invite_code?: string } } }) {
      const display_name = options?.data?.display_name || email.split('@')[0];
      const usernameBase = display_name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'trader';
      const username = `${usernameBase.slice(0, 23)}_${crypto.randomUUID().slice(0, 8)}`;
      const result = await api('/api/auth/signup', { email, password, display_name, username, invite_code: options?.data?.pilot_invite_code });
      if (result.error || !result.data) return { error: result.error, data: { user: null } };
      const session = sessionFrom(result.data.user as Row);
      emit('SIGNED_IN', session);
      return { error: null, data: { user: result.data.user, session } };
    },
    async signOut() {
      const result = await api('/api/auth/signout', {});
      if (result.error) return { error: result.error };
      emit('SIGNED_OUT', null);
      return { error: null };
    },
    async updateUser({ password, current_password }: { password: string; current_password: string }) {
      const result = await api('/api/auth/password', { password, current_password });
      if (!result.error) emit('SIGNED_OUT', null);
      return { error: result.error };
    },
  },
  storage: {
    from(bucket: string) {
      const base = '/api/media';
      return {
        async upload(path: string, file: Blob, options?: { contentType?: string; upsert?: boolean }) {
          if (bucket !== 'trading-media') return { data: null, error: { message: 'Unsupported media bucket.' } };
          const url = `${base}/upload?path=${encodeURIComponent(path)}`;
          const result = await mediaApi(url, 'PUT', file, options?.contentType || file.type || 'application/octet-stream');
          return { data: result.data ? { path } : null, error: result.error };
        },
        async download(path: string) {
          if (bucket !== 'trading-media') return { data: null, error: { message: 'Unsupported media bucket.' } };
          const result = await mediaApi(`${base}/download?path=${encodeURIComponent(path)}`);
          return result.error || !result.data
            ? { data: null, error: result.error }
            : { data: await result.data.blob(), error: null };
        },
        async list(prefix: string, options?: { limit?: number; offset?: number }): Promise<{ data: { id: string; name: string; metadata: { mimetype: string } }[] | null; error: { message: string } | null }> {
          if (bucket !== 'trading-media') return { data: null, error: { message: 'Unsupported media bucket.' } };
          const params = new URLSearchParams({ prefix, limit: String(options?.limit ?? 100), offset: String(options?.offset ?? 0) });
          const result = await api(`${base}/list?${params}`, undefined, 'GET');
          const files = result.data?.files;
          return { data: Array.isArray(files) ? files as { id: string; name: string; metadata: { mimetype: string } }[] : null, error: result.error };
        },
        async createSignedUrl(path: string, expiresIn: number) {
          void expiresIn;
          const result = await this.download(path);
          if (result.error || !result.data) return { data: null, error: result.error };
          return { data: { signedUrl: URL.createObjectURL(result.data) }, error: null };
        },
      };
    },
  },
  functions: {
    async invoke(name: string, { body }: { body: Row }) {
      if (name !== 'admin-user-management') return { data: null, error: { message: 'Unknown function.' } };
      const result = await api('/api/admin', body);
      return { data: result.data, error: result.error };
    },
  },
};
