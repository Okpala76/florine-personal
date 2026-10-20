import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, projectScope } from '../../lib/cloud/client';
import { startSync, type SyncStatus } from '../../lib/cloud/sync';
import { useProgress } from '../../lib/storage/progress';
import { emptyProgress } from '../../lib/cloud/model';
const button = 'rounded bg-marine px-4 py-2 text-white disabled:opacity-50';

function SignIn() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      if (mode === 'reset') {
        const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setMessage('If this account can receive recovery email, a password reset link will arrive shortly.');
      } else if (mode === 'signup') {
        const { data, error } = await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) setMessage('Check your email to confirm your account, then return here to sign in.');
      } else {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign in. Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto my-12 max-w-md rounded-xl border border-ink/20 bg-parchment p-6 shadow-lg">
    <h1 className="font-display text-3xl text-rouge">Florine · your French journey</h1>
    <p className="my-3 text-sm">Sign in with the same account on your phone and computer to continue your lessons.</p>
    <form onSubmit={submit} className="space-y-4">
      <label className="block">Email<input className="mt-1 block w-full rounded border bg-white p-2 text-ink" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      {mode !== 'reset' && <label className="block">Password<input className="mt-1 block w-full rounded border bg-white p-2 text-ink" type="password" minLength={mode === 'signup' ? 12 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={e => setPassword(e.target.value)} />{mode === 'signup' && <small>Use at least 12 characters.</small>}</label>}
      <button className={button + ' w-full'} disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send recovery link' : 'Sign in'}</button>
    </form>
    <p role="status" className="my-3 text-sm break-words">{message}</p>
    <div className="flex flex-wrap gap-4 text-sm">
      <button className="underline" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMessage(''); }}>{mode === 'signup' ? 'Already have an account? Sign in' : 'Create an account'}</button>
      <button className="underline" onClick={() => { setMode(mode === 'reset' ? 'login' : 'reset'); setMessage(''); }}>{mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}</button>
    </div>
  </div>;
}

function Recovery({ done }: { done: () => void }) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password });
    setBusy(false);
    if (error) setMessage(error.message); else done();
  }
  return <form onSubmit={submit} className="mx-auto my-12 max-w-md space-y-4 rounded border bg-parchment p-6">
    <h1 className="text-xl">Choose your new password</h1>
    <label className="block">New password<input className="block w-full rounded border bg-white p-2" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button className={button} disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button><p role="status">{message}</p>
  </form>;
}

function StudySession({ session, children }: { session: Session; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SyncStatus>({ state: 'syncing', message: 'Loading your saved progress…', pending: 0 });
  const [failure, setFailure] = useState('');
  const [controller, setController] = useState<ReturnType<typeof startSync> | null>(null);
  useEffect(() => {
    useProgress.setState(emptyProgress());
    let sync: ReturnType<typeof startSync> | undefined;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      try {
        sync = startSync(supabase!, projectScope, session.user.id, setStatus);
        setController(sync); setReady(true);
      } catch (e) { setFailure(e instanceof Error ? e.message : 'Saved data could not be opened.'); }
    });
    return () => { disposed = true; sync?.stop(); useProgress.setState(emptyProgress()); };
  }, [session.user.id]);
  function download() {
    const blob = new Blob([controller!.exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `florine-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function logout() {
    // Retain pending events under this account's key; no other account loads them.
    const { error } = await supabase!.auth.signOut({ scope: 'local' });
    if (error) setFailure(error.message);
  }
  if (failure && !ready) return <div className="m-8 rounded border bg-parchment p-6"><h1>We could not safely open your saved progress</h1><p role="alert">{failure}</p><p>Your saved data has not been reset. Please keep this browser data and contact support.</p><button className={button} onClick={logout}>Sign out</button></div>;
  return <>
    <div className="border-b bg-parchment px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
        <span className="max-w-full break-all">{session.user.email}</span>
        <span role="status" className={status.state === 'error' ? 'text-rouge' : ''}>{status.message}{status.pending > 0 ? ` (${status.pending} pending)` : ''}</span>
        <div className="ml-auto flex flex-wrap gap-3">
          <button className="underline" onClick={() => controller?.retry()}>Sync now</button>
          <button className="underline" disabled={!controller} onClick={download}>Export backup</button>
          <label className="cursor-pointer underline">Restore backup<input className="sr-only" type="file" accept=".json,application/json" onChange={async e => {
            const file = e.target.files?.[0];
            if (file && window.confirm('Add the activities from this backup to your signed-in account?')) {
              try { controller?.restoreBackup(await file.text()); setFailure(''); }
              catch (error) { setFailure(error instanceof Error ? error.message : 'Invalid backup.'); }
            }
            e.target.value = '';
          }} /></label>
          <button className="underline" onClick={logout}>Sign out</button>
        </div>
      </div>
      {failure && <p role="alert" className="mx-auto max-w-4xl text-rouge">{failure}</p>}
    </div>
    {ready ? children : <p className="p-8" role="status">Loading your account…</p>}
  </>;
}

export default function AccountGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let active = true, authEvent = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      authEvent = true; setSession(next); setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    void supabase.auth.getSession().then(({ data, error: problem }) => {
      if (!active || authEvent) return;
      if (problem) setError(problem.message);
      setSession(data.session); setLoading(false);
    }).catch(() => { if (active) { setError('Could not load your sign-in session. Please reconnect and reload.'); setLoading(false); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  if (!supabase) return <p className="p-8">Florine needs its Supabase connection settings before sign-in is available.</p>;
  if (loading) return <p className="p-8" role="status">Checking your account…</p>;
  if (error && !session) return <p className="p-8" role="alert">{error}</p>;
  if (!session) return <SignIn />;
  if (recovery) return <Recovery done={() => setRecovery(false)} />;
  return <StudySession key={session.user.id} session={session}>{children}</StudySession>;
}
