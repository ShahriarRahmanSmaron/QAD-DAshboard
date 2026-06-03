import { LandingPage } from "@/components/public/landing-page";
import { getCurrentUser } from "@/lib/auth/server";

/**
 * MD09-LP: Root page — public landing experience.
 *
 * The landing page is always rendered (no redirect to login).
 * `isAuthenticated` controls CTA copy and modal vs direct navigation.
 */
export default async function Home() {
  const user = await getCurrentUser();

  return <LandingPage isAuthenticated={!!user} />;
}
