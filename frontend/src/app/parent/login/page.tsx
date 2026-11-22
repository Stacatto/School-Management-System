'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, GraduationCap, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

export default function ParentLoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore(state => state.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/auth/login', { email: email.trim(), password });
      const { user, accessToken, refreshToken } = response.data.data;
      if (user?.role !== 'PARENT') {
        setError('This sign-in page is for parent and guardian accounts. Use the main sign-in page for other accounts.');
        return;
      }
      setAuth(user, accessToken, refreshToken);
      router.push('/parent/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'We could not sign you in. Check your email and password, then try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f0f2f8] p-5">
      <section className="w-full max-w-md">
        <Link href="/login" className="mb-6 flex items-center justify-center gap-2 text-gray-700 hover:text-violet-700">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white"><GraduationCap className="h-5 w-5" /></span>
          <span className="text-xl font-bold">SchoolMS</span>
        </Link>

        <div className="rounded-3xl border border-gray-100 bg-white p-8 shadow-lg">
          <div className="mb-7 flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><Users className="h-6 w-6" /></span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Parent &amp; Guardian Sign In</h1>
              <p className="mt-1 text-sm text-gray-500">View your linked student’s school updates.</p>
            </div>
          </div>

          <form onSubmit={signIn} className="space-y-5">
            <label className="block">
              <span className="label">Email address</span>
              <input className="input focus-visible:ring-2 focus-visible:ring-violet-500" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <span className="relative block">
                <input className="input pr-11 focus-visible:ring-2 focus-visible:ring-violet-500" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>

            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            <button type="submit" disabled={busy} className="w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? 'Signing in…' : 'Sign in to Parent Portal'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Need a parent account? Ask your school administrator for an invitation.
          </p>
          <p className="mt-3 text-center text-sm text-gray-500">
            <Link href="/login" className="font-semibold text-violet-700 hover:underline">Back to all sign-in options</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
