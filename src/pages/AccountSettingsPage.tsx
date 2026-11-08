import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, Search, ShieldCheck, Trash2, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ColorPaletteControl } from '@/components/ColorPaletteControl';
import { DataBackupModal } from '@/components/DataBackupModal';

type Member = { id: string; email: string; username?: string | null; display_name?: string | null; role?: string; account_status?: 'active' | 'suspended'; created_at?: string; suspended_at?: string | null; suspension_expires_at?: string | null; last_sign_in_at?: string | null; trade_count: number; plan_count: number };
type AuditEntry = { id: string; action: string; outcome: string; target_user_id: string | null; created_at: string; metadata: Record<string, unknown> };

export function AccountSettingsPage() {
  const { profile, updateProfile, updatePassword } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [tradingStyle, setTradingStyle] = useState(profile?.trading_style || '');
  const [profileState, setProfileState] = useState<{ error?: string; success?: string }>({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordState, setPasswordState] = useState<{ error?: string; success?: string }>({});
  const [backupOpen, setBackupOpen] = useState(false);
  const isAdmin = profile?.role === 'admin' && profile.account_status === 'active';

  useEffect(() => {
    setDisplayName(profile?.display_name || ''); setUsername(profile?.username || ''); setBio(profile?.bio || ''); setTradingStyle(profile?.trading_style || '');
  }, [profile]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); setProfileState({});
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(normalizedUsername)) return setProfileState({ error: 'Username must be 3–32 letters, numbers, or underscores.' });
    const { error } = await updateProfile({ display_name: displayName.trim(), username: normalizedUsername, bio: bio.trim() || null, trading_style: tradingStyle.trim() || null });
    setProfileState(error ? { error } : { success: 'Profile saved.' });
  };
  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setPasswordState({});
    if (password.length < 8) return setPasswordState({ error: 'Use at least 8 characters.' });
    if (password !== passwordConfirm) return setPasswordState({ error: 'Passwords do not match.' });
    const { error } = await updatePassword(password, currentPassword);
    if (error) setPasswordState({ error }); else { setCurrentPassword(''); setPassword(''); setPasswordConfirm(''); setPasswordState({ success: 'Password updated.' }); }
  };

  return <div className="space-y-6">
    <SectionHeader title="Account Settings" subtitle="Manage your profile, security, appearance, and private data." />
    <div className="grid gap-6 xl:grid-cols-2">
      <form className="card space-y-4 p-5" onSubmit={saveProfile}>
        <h2 className="font-bold">Profile</h2>
        <label className="block text-sm font-medium">Username<input className="input-field mt-1.5" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" /></label>
        <label className="block text-sm font-medium">Display name<input className="input-field mt-1.5" value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" /></label>
        <label className="block text-sm font-medium">Trading style<input className="input-field mt-1.5" value={tradingStyle} onChange={event => setTradingStyle(event.target.value)} placeholder="e.g. Intraday FX" /></label>
        <label className="block text-sm font-medium">Bio<textarea className="input-field mt-1.5 min-h-24" value={bio} onChange={event => setBio(event.target.value)} /></label>
        <Status state={profileState} /><button className="btn-primary" type="submit">Save profile</button>
      </form>
      <div className="space-y-6">
        <form className="card space-y-4 p-5" onSubmit={savePassword}><div className="flex items-center gap-2"><KeyRound size={18} className="text-orange-500" /><h2 className="font-bold">Security</h2></div>
          <label className="block text-sm font-medium">Current password<input required type="password" className="input-field mt-1.5" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label className="block text-sm font-medium">New password<input type="password" className="input-field mt-1.5" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" /></label>
          <label className="block text-sm font-medium">Confirm new password<input type="password" className="input-field mt-1.5" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} autoComplete="new-password" /></label>
          <Status state={passwordState} /><button className="btn-primary" type="submit">Update password</button>
        </form>
        <section className="card p-5"><h2 className="font-bold">Appearance & data</h2><div className="mt-4"><ColorPaletteControl /></div><button className="btn-secondary mt-4" onClick={() => setBackupOpen(true)}>Open data backup & restore</button></section>
      </div>
    </div>
    {isAdmin && <AdminConsole />}
    <DataBackupModal open={backupOpen} onClose={() => setBackupOpen(false)} />
  </div>;
}

function Status({ state }: { state: { error?: string; success?: string } }) {
  if (state.error) return <p role="alert" className="text-sm text-error-500">{state.error}</p>;
  if (state.success) return <p role="status" className="text-sm text-success-600">{state.success}</p>;
  return null;
}

function AdminConsole() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]); const [audit, setAudit] = useState<AuditEntry[]>([]); const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true); const [actionId, setActionId] = useState<string | null>(null); const [message, setMessage] = useState<{ text: string; kind: 'error' | 'success' }>({ text: '', kind: 'success' });
  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('admin-user-management', { body });
    if (error) throw new Error(error.message);
    if (!data) throw new Error('The administration service returned no data.');
    if (data.error) throw new Error(String(data.error));
    return data;
  };
  const load = useCallback(async () => { setLoading(true); try { const [memberResult, auditResult] = await Promise.all([invoke({ action: 'list' }), invoke({ action: 'audit' })]); setMembers(Array.isArray(memberResult.members) ? memberResult.members as Member[] : []); setAudit(Array.isArray(auditResult.entries) ? auditResult.entries as AuditEntry[] : []); } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Could not load administration data.', kind: 'error' }); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const visibleMembers = useMemo(() => members.filter(member => [member.email, member.username, member.display_name].some(value => value?.toLowerCase().includes(query.toLowerCase()))), [members, query]);
  const act = async (action: 'suspend' | 'restore' | 'delete', member: Member) => {
    if (action === 'delete' && !confirm(`Permanently delete ${member.username || member.email}, including their private records and uploads? This cannot be undone.`)) return;
    setActionId(member.id); setMessage({ text: '', kind: 'success' }); try { await invoke({ action, targetUserId: member.id }); setMessage({ text: action === 'delete' ? 'Member deleted.' : `Member ${action}d.`, kind: 'success' }); await load(); } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Administration action failed.', kind: 'error' }); } finally { setActionId(null); }
  };
  return <section className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck size={19} className="text-orange-500" /><h2 className="font-bold">Administration</h2></div><p className="mt-1 text-sm text-muted">Member operations do not expose private trade content.</p></div></div>
    <div className="relative mt-5 max-w-md"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input-field pl-9" placeholder="Search members" value={query} onChange={event => setQuery(event.target.value)} /></div>{message.text && <p role="status" className={`mt-3 text-sm ${message.kind === 'error' ? 'text-error-500' : 'text-success-600'}`}>{message.text}</p>}
    {loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading members…</div> : <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-themed text-xs uppercase text-muted"><tr><th className="px-3 py-2">Member</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Usage</th><th className="px-3 py-2">Actions</th></tr></thead><tbody>{visibleMembers.map(member => <tr key={member.id} className="border-b border-themed/70"><td className="px-3 py-3"><p className="font-semibold">{member.username || member.display_name || 'Member'} {member.id === user?.id && <span className="text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{member.email}</p></td><td className="px-3 py-3"><span className={member.account_status === 'suspended' ? 'badge badge-warning' : 'badge badge-success'}>{member.account_status || 'active'}</span></td><td className="px-3 py-3 text-xs text-muted">{member.trade_count} trades · {member.plan_count} plans</td><td className="px-3 py-3"><div className="flex gap-2">{member.role !== 'admin' && member.id !== user?.id && <>{member.account_status === 'suspended' ? <button className="btn-ghost p-2 text-success-600" disabled={actionId === member.id} title="Restore" onClick={() => act('restore', member)}><UserRoundCheck size={16} /></button> : <button className="btn-ghost p-2 text-amber-600" disabled={actionId === member.id} title="Suspend" onClick={() => act('suspend', member)}><UserRoundX size={16} /></button>}<button className="btn-ghost p-2 text-error-500" disabled={actionId === member.id} title="Delete permanently" onClick={() => act('delete', member)}><Trash2 size={16} /></button></>}</div></td></tr>)}</tbody></table></div>}
    <details className="mt-6 border-t border-themed pt-4"><summary className="cursor-pointer text-sm font-semibold">Recent administration audit</summary><div className="mt-3 space-y-2 text-xs text-muted">{audit.length ? audit.map(entry => <div key={entry.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-secondary px-3 py-2"><span>{entry.action} · {entry.outcome}</span><span>{new Date(entry.created_at).toLocaleString()}</span></div>) : <p>No administration actions recorded.</p>}</div></details>
  </section>;
}
