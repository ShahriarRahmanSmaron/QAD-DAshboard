import { AppShell } from "@/components/layout/app-shell";
import { WfTestDashboard } from "@/components/dashboards/wf-test-dashboard";
import { getCurrentUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export default async function WfTestDashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell user={user}>
      <WfTestDashboard />
    </AppShell>
  );
}
