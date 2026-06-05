import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/server";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

function getSafeNextPath(nextPath: string | undefined) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/dashboard";
  }

  return nextPath;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (user) {
    redirect(getSafeNextPath(params.next));
  }

  return <LoginForm nextPath={getSafeNextPath(params.next)} />;
}
