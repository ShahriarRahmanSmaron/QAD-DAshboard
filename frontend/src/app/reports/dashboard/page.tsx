import { AppShell } from "@/components/layout/app-shell";
import { DynamicDashboard } from "@/components/dashboards/dynamic-dashboard";
import { getCurrentUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell user={user}>
      <DynamicDashboard user={user} />
    </AppShell>
  );
}
