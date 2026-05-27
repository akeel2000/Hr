"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { LoginForm } from "../../components/login-form";
import { firebaseAuth, hasFirebaseConfig } from "../../lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!firebaseAuth) {
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setAuthReady(true);

      if (hasFirebaseConfig() && user) {
        router.replace("/");
      }
    });

    return () => unsubscribe();
  }, [router]);

  if (!authReady) {
    return (
      <main className="auth-shell">
        <article className="auth-card card">
          <p className="eyebrow">Checking session</p>
          <h1>Preparing access control.</h1>
          <p className="hero-copy">Firebase is verifying whether this browser already has an active session.</p>
        </article>
      </main>
    );
  }

  return <LoginForm redirectTo="/" />;
}
