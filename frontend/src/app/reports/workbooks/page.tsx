import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { WorkbookGovernanceModule } from "@/components/reports/workbook-governance-module";
import { getCurrentUser } from "@/lib/auth/server";

export default async function WorkbookGovernancePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/reports/workbooks");
  }

  return (
    <AppShell user={user}>
      <WorkbookGovernanceModule isAdmin={user.role === "admin"} />
    </AppShell>
  );
}
