"use client";

import { FormEvent, useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { firebaseAuth, hasFirebaseConfig } from "../lib/firebase";

type LoginFormProps = {
  onSignedIn?: () => void;
  redirectTo?: string;
};

export function LoginForm({ onSignedIn, redirectTo = "/" }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseAuth) {
      setError("Firebase is not configured. Add the NEXT_PUBLIC_FIREBASE_* values first.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
      onSignedIn?.();
      router.replace(redirectTo);
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : "Login failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-shell">
      <article className="auth-card card">
        <p className="eyebrow">Secure Access</p>
        <h1>Sign in to view the monthly performance dashboard.</h1>
        <p className="hero-copy">
          Use Firebase Authentication with email and password. After login, the dashboard loads the monthly data from your Apps Script endpoint.
        </p>

        {!hasFirebaseConfig() ? (
          <div className="auth-warning">
            Firebase is not configured yet. Add the values from `.env.example` into `.env.local`.
          </div>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="manager@company.com"
              required
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
          </label>

          {error ? <p className="auth-error">{error}</p> : null}

          <button type="submit" disabled={submitting || !hasFirebaseConfig()}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </article>
    </section>
  );
}
