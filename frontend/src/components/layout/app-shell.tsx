"use client";

import { motion } from "framer-motion";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import type { AuthUser } from "@/lib/auth/types";

type AppShellProps = {
  user: AuthUser;
};

export function AppShell({ user }: AppShellProps) {
  return (
    <div className="min-h-screen">
      <Sidebar role={user.role} />
      <div className="lg:pl-72">
        <Topbar user={user} />
        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-7xl flex-col px-5 py-8 sm:px-8 lg:px-10"
        >
          <section className="flex flex-1 flex-col justify-between rounded-lg border bg-card p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:p-10">
            <div className="max-w-3xl">
              <p className="text-sm font-medium text-muted-foreground">
                DBL QAD Portal
              </p>
              <h1 className="mt-4 text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                Quality assurance workspace
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                A clean foundation for textile QAD operations, ready for feature
                modules, analytics, uploads, realtime workflows, and
                auditability.
              </p>
            </div>
            <div className="mt-16 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-background/60 p-4 backdrop-blur">
                <p className="text-sm font-medium">Frontend</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Next.js App Router
                </p>
              </div>
              <div className="rounded-md border bg-background/60 p-4 backdrop-blur">
                <p className="text-sm font-medium">Backend</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  FastAPI async services
                </p>
              </div>
              <div className="rounded-md border bg-background/60 p-4 backdrop-blur">
                <p className="text-sm font-medium">Platform</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  PostgreSQL and Supabase
                </p>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
