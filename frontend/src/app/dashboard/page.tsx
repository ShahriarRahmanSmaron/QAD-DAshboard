import { AppShell } from "@/components/layout/app-shell";
import { DashboardHome } from "@/components/reports/dashboard-home";
import { getCurrentUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell user={user}>
      <DashboardHome fullName={user.full_name} />
    </AppShell>
  );
}
