import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ReportSchemaTester } from "@/components/reports/report-schema-tester";
import { getCurrentUser } from "@/lib/auth/server";

export default async function ReportSchemaTestPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/reports/schema-test");
  }

  return (
    <AppShell user={user}>
      <ReportSchemaTester />
    </AppShell>
  );
}
