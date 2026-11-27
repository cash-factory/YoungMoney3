import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ColorPaletteControl } from '@/components/ColorPaletteControl';
import { DataBackupModal } from '@/components/DataBackupModal';
import {UsernameField} from '@/components/UsernameField';


export function AccountSettingsPage() {
  const { profile, updateProfile, updatePassword } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [tradingStyle, setTradingStyle] = useState(profile?.trading_style || '');
  const [profileState, setProfileState] = useState<{ error?: string; success?: string }>({});
  const [savingProfile,setSavingProfile]=useState(false);
  const [savingPassword,setSavingPassword]=useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordState, setPasswordState] = useState<{ error?: string; success?: string }>({});
  const [backupOpen, setBackupOpen] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name || ''); setUsername(profile?.username || ''); setBio(profile?.bio || ''); setTradingStyle(profile?.trading_style || '');
  }, [profile]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); setProfileState({});
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(normalizedUsername)) return setProfileState({ error: 'Username must be 3–32 letters, numbers, or underscores.' });
    setSavingProfile(true);
    try{
      const {error}=await updateProfile({display_name:displayName.trim(),username:normalizedUsername,bio:bio.trim()||null,trading_style:tradingStyle.trim()||null});
      setProfileState(error ? {error} : {success:'Profile saved. Your username will also update on paired Signal Desks after their next online check-in.'});
    }finally{setSavingProfile(false)}
  };
  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setPasswordState({});
    if (password.length < 8) return setPasswordState({ error: 'Use at least 8 characters.' });
    if (password !== passwordConfirm) return setPasswordState({ error: 'Passwords do not match.' });
    setSavingPassword(true);
    try{
      const {error}=await updatePassword(password,currentPassword);
      if(error)setPasswordState({error});else{setCurrentPassword('');setPassword('');setPasswordConfirm('');setPasswordState({success:'Password updated.'});}
    }finally{setSavingPassword(false)}
  };

  return <div className="space-y-6">
    <SectionHeader title="Account Settings" subtitle="Manage your profile, security, appearance, and private data." />
    <div className="grid gap-6 xl:grid-cols-2">
      <form className="card space-y-4 p-5" onSubmit={saveProfile}>
        <h2 className="font-bold">Profile</h2>
        <UsernameField id="settings-username" value={username} onChange={setUsername} label="Unique username / Signal Desk identity" />
        <label className="block text-sm font-medium">Display name<input className="input-field mt-1.5" value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" /></label>
        <label className="block text-sm font-medium">Trading style<input className="input-field mt-1.5" value={tradingStyle} onChange={event => setTradingStyle(event.target.value)} placeholder="e.g. Intraday FX" /></label>
        <label className="block text-sm font-medium">Bio<textarea className="input-field mt-1.5 min-h-24" value={bio} onChange={event => setBio(event.target.value)} /></label>
        <Status state={profileState} /><button className="btn-primary" type="submit" disabled={savingProfile} aria-busy={savingProfile}>{savingProfile?'Saving profile…':'Save profile'}</button>
      </form>
      <div className="space-y-6">
        <form className="card space-y-4 p-5" onSubmit={savePassword}><div className="flex items-center gap-2"><KeyRound size={18} className="text-orange-500" /><h2 className="font-bold">Security</h2></div>
          <label className="block text-sm font-medium">Current password<input required type="password" className="input-field mt-1.5" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label className="block text-sm font-medium">New password<input type="password" className="input-field mt-1.5" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" /></label>
          <label className="block text-sm font-medium">Confirm new password<input type="password" className="input-field mt-1.5" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} autoComplete="new-password" /></label>
          <Status state={passwordState} /><button className="btn-primary" type="submit" disabled={savingPassword} aria-busy={savingPassword}>{savingPassword?'Updating password…':'Update password'}</button>
        </form>
        <section className="card p-5"><h2 className="font-bold">Appearance & data</h2><div className="mt-4"><ColorPaletteControl /></div><button className="btn-secondary mt-4" onClick={() => setBackupOpen(true)}>Open data backup & restore</button></section>
      </div>
    </div>
    <DataBackupModal open={backupOpen} onClose={() => setBackupOpen(false)} />
  </div>;
}

function Status({ state }: { state: { error?: string; success?: string } }) {
  if (state.error) return <p role="alert" className="text-sm text-error-500">{state.error}</p>;
  if (state.success) return <p role="status" className="text-sm text-success-600">{state.success}</p>;
  return null;
}

