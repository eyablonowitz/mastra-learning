"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? `Request failed with status ${response.status}.`;
}

export function SignIn() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);

    if (!response) {
      setError("Could not reach the local server.");
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      setError(await readError(response));
      setIsSubmitting(false);
      return;
    }

    router.refresh();
  };

  return (
    <main className="sign-in-shell">
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">Local learning project</p>
        <h1 id="sign-in-title">Choose your chat identity</h1>
        <p className="sign-in-intro">
          Enter a name to keep your conversations separate and resume them on
          this browser.
        </p>

        <form className="sign-in-form" onSubmit={submit}>
          <label htmlFor="name">Name</label>
          <input
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            autoFocus
            disabled={isSubmitting}
            placeholder="Ada Lovelace"
          />
          {error ? <p className="sign-in-error">{error}</p> : null}
          <button
            className="primary-button"
            type="submit"
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? "Starting…" : "Continue to chat"}
          </button>
        </form>

        <p className="fake-auth-notice">
          This is a development-only identity prompt, not secure
          authentication. Anyone can enter another person&apos;s name.
        </p>
      </section>
    </main>
  );
}
