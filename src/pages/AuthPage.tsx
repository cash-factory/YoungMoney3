import { useState } from 'react';
import { TrendingUp, Mail, Lock, User, Eye, EyeOff, AlertCircle, Loader2, BarChart3, Users, BookOpen, Sparkles, Shield, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ColorPaletteControl } from '@/components/ColorPaletteControl';

export function AuthPage({ onBack }: { onBack?: () => void }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === 'signup') {
      if (!displayName.trim()) {
        setError('Please enter your display name.');
        setLoading(false);
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        setLoading(false);
        return;
      }
      const { error } = await signUp(email.trim(), password, displayName.trim(), inviteCode.trim());
      if (error) {
        setError(error);
        setLoading(false);
      }
    } else {
      const { error } = await signIn(email.trim(), password);
      if (error) {
        setError(error);
        setLoading(false);
      }
    }
  };

  const features = [
    { icon: BarChart3, title: 'Deep Analytics', desc: 'Track every dimension of your trading performance' },
    { icon: Users, title: 'Shared Accountability', desc: 'See each other\'s trades. Stay honest. Grow together.' },
    { icon: BookOpen, title: 'Smart Journaling', desc: 'Checklists, reviews, mood tracking & AI-powered insights' },
    { icon: Sparkles, title: 'AI Pattern Detection', desc: 'Automatic analysis of your habits and edge' },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left showcase panel */}
      <div className="auth-showcase hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }} />
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-orange-400/20 blur-3xl animate-float-slow" />
        <div className="absolute bottom-0 -left-32 w-96 h-96 rounded-full bg-amber-500/15 blur-3xl animate-drift" />
        <div className="absolute top-1/2 left-1/2 w-80 h-80 rounded-full bg-red-500/10 blur-3xl animate-pulse-glow" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
              <TrendingUp size={28} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Young-Money-Fx</h1>
              <p className="text-xs text-white/60">Accountability, not competition</p>
            </div>
          </div>

          <div className="max-w-md">
            <h2 className="text-4xl xl:text-5xl font-extrabold tracking-tight leading-[1.1]">
              Trade with<br />
              <span className="text-orange-300">radical honesty.</span>
            </h2>
            <p className="mt-4 text-base text-white/70 leading-relaxed">
              A private trading journal to log every trade, review every decision,
              and build a consistent process without sharing your records.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-4">
              {features.map(f => (
                <div key={f.title} className="p-4 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 transition-colors">
                  <f.icon size={20} className="text-orange-300 mb-2" />
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-xs text-white/50 mt-0.5 leading-snug">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-white/40">
            <Shield size={14} />
            Private & secure. Your journal is private to your account.
          </div>
        </div>
      </div>

      {/* Right auth form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-primary relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 right-1/4 w-64 h-64 rounded-full bg-orange-500/5 blur-3xl" />
          <div className="absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full bg-amber-500/5 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          <div className="mb-5 flex justify-end"><ColorPaletteControl compact /></div>
          {onBack && (
            <button onClick={onBack} className="btn-ghost mb-6 -ml-2 text-sm">
              <ArrowLeft size={16} /> Back to home
            </button>
          )}

          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 text-white mb-3 shadow-lg shadow-orange-500/20">
              <TrendingUp size={28} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Young-Money-Fx</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">
              {mode === 'signin' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="text-sm text-muted mt-1">
              {mode === 'signin'
                ? 'Sign in with your account email and password. The pilot invite code is only for account creation.'
                : 'Start journaling your trades with accountability'}
            </p>
          </div>

          <div className="flex gap-1 p-1 rounded-xl bg-secondary mb-6">
            <button
              onClick={() => { setMode('signin'); setError(null); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${mode === 'signin' ? 'bg-card text-primary shadow-sm' : 'text-muted hover:text-secondary'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${mode === 'signup' ? 'bg-card text-primary shadow-sm' : 'text-muted hover:text-secondary'}`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide">Display Name</label>
                <div className="relative">
                  <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    className="input-field pl-10"
                    placeholder="Your trader name"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide">Pilot Invite Code</label>
                <div className="relative">
                  <Shield size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    className="input-field pl-10"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    autoComplete="off"
                    required
                  />
                </div>
                <p className="mt-1 text-xs text-muted">Ask the workspace owner for the private pilot code.</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide">Email</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="email"
                  className="input-field pl-10"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide">Password</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input-field pl-10 pr-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondary transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-error-500/10 border border-error-500/20 text-sm text-error-500 animate-slide-up">
                <AlertCircle size={16} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? <><Loader2 size={18} className="animate-spin" /> Please wait...</> : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-xs text-muted text-center mt-5">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
              className="text-orange-500 hover:underline font-medium"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
