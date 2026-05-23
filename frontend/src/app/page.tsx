import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return <AppShell user={user} />;
}
