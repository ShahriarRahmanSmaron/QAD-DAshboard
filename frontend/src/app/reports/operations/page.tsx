import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { OperationalQueryModule } from "@/components/reports/operational-query-module";
import { getCurrentUser } from "@/lib/auth/server";

export default async function OperationalQueryPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/reports/operations");
  }

  return (
    <AppShell user={user}>
      <OperationalQueryModule />
    </AppShell>
  );
}
