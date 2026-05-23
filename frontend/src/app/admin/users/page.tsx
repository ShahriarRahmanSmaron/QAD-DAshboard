import { redirect } from "next/navigation";
import { AdminUserManagement } from "@/components/admin/admin-user-management";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth/server";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/admin/users");
  }

  if (user.role !== "admin") {
    redirect("/");
  }

  return (
    <AppShell user={user}>
      <AdminUserManagement />
    </AppShell>
  );
}
