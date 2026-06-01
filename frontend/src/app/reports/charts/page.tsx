import { AppShell } from "@/components/layout/app-shell";
import { ChartBuilderPage } from "@/components/charts/chart-builder-page";
import { getCurrentUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export default async function ChartsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell user={user}>
      <ChartBuilderPage />
    </AppShell>
  );
}
