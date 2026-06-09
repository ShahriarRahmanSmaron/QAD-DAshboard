import { AppShell } from "@/components/layout/app-shell";
import { BuyerDashboardPage } from "@/components/dashboards/buyer-dashboard-page";
import { getCurrentUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Buyer Dashboard | QAD Dashboard",
  description: "Overview of buyer-wise performance metrics.",
};

export default async function BuyerDashboard() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/buyer-dashboard");
  }

  if (user.role !== "admin" && !user.permissions.includes("buyers:access")) {
    redirect("/");
  }

  return (
    <AppShell user={user}>
      <BuyerDashboardPage user={user} />
    </AppShell>
  );
}
