import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ReportGridModule } from "@/components/reports/report-grid-module";
import { getCurrentUser } from "@/lib/auth/server";

export default async function ReportGridPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/reports/grid");
  }

  return (
    <AppShell user={user}>
      <ReportGridModule />
    </AppShell>
  );
}
