"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

type LoginFormProps = {
  nextPath: string;
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: typeof email === "string" ? email : "",
        password: typeof password === "string" ? password : "",
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      setError(data?.message ?? "Unable to sign in.");
      setIsSubmitting(false);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10 sm:px-8">
      <section className="w-full max-w-[26rem] rounded-lg border bg-card p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:p-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">DBL QAD</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal">
            Sign in to portal
          </h1>
        </div>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Email</span>
            <span className="flex h-11 items-center gap-3 rounded-md border bg-background/70 px-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
              <Mail className="size-4 text-muted-foreground" />
              <input
                autoComplete="email"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                name="email"
                placeholder="name@company.com"
                required
                type="email"
              />
            </span>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Password</span>
            <span className="flex h-11 items-center gap-3 rounded-md border bg-background/70 px-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
              <LockKeyhole className="size-4 text-muted-foreground" />
              <input
                autoComplete="current-password"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                name="password"
                required
                type="password"
              />
            </span>
          </label>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </section>
    </main>
  );
}
