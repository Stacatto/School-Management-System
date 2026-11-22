'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

export default function AcceptGuardianInvitationPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || ''), []);

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (user?.role === 'PARENT') await api.post('/parent/accept-invitation/signed-in', { token });
      else await api.post('/parent/accept-invitation', { token, name, password });
      toast.success('Guardian link confirmed');
      if (user?.role === 'PARENT') router.push('/parent/dashboard');
      else router.push('/parent/login');
    } catch (err: any) {
      const message = err?.response?.data?.message || 'Could not accept this invitation';
      setError(message);
      if (message.includes('Sign in first')) toast.error('Sign in to the invited parent account, then reopen this invitation link.');
    } finally { setBusy(false); }
  };

  if (!token) return <main className="min-h-screen flex items-center justify-center p-6"><section className="card max-w-md text-center"><h1 className="text-xl font-semibold">Invitation link is incomplete</h1><p className="mt-2 text-gray-600">Ask the school administrator for a new guardian invitation.</p><Link className="btn-primary inline-block mt-5" href="/login">Go to sign in</Link></section></main>;

  const signedInAsParent = user?.role === 'PARENT';
  return <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
    <form onSubmit={accept} className="card w-full max-w-md space-y-4">
      <div><h1 className="text-2xl font-semibold text-gray-900">Link your guardian account</h1><p className="text-sm text-gray-600 mt-1">This invitation confirms your access to the student named by the school.</p></div>
      {signedInAsParent ? <p className="rounded-lg bg-violet-50 p-3 text-sm text-violet-900">Signed in as {user.email}. Confirm to link this student to your account.</p> : <>
        {user && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">You are signed in with a {user.role.toLowerCase()} account. Sign out, then open this invitation to create or use the parent account.</p>}
        <label className="block"><span className="label">Your full name</span><input className="input" autoComplete="name" required minLength={2} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="block"><span className="label">Create a password</span><input className="input" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={e => setPassword(e.target.value)} /><span className="text-xs text-gray-500">Use at least 12 characters.</span></label>
      </>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || (!!user && !signedInAsParent)}>{busy ? 'Confirming…' : 'Accept invitation'}</button>
      <p className="text-xs text-gray-500">Only use this link if you received it from your school administrator. It expires and can be used once.</p>
    </form>
  </main>;
}
