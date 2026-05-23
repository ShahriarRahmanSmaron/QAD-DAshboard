"use client";

import { LogOut, Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSidebarStore } from "@/hooks/use-sidebar-store";
import type { AuthUser } from "@/lib/auth/types";

type TopbarProps = {
  user: AuthUser;
};

export function Topbar({ user }: TopbarProps) {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const toggleSidebar = useSidebarStore((state) => state.toggle);
  const nextTheme = theme === "dark" ? "light" : "dark";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
        <div className="flex items-center gap-3">
          <Button
            aria-label="Open sidebar"
            className="lg:hidden"
            onClick={toggleSidebar}
            size="icon"
            variant="ghost"
          >
            <Menu size={18} />
          </Button>
          <div>
            <p className="text-sm text-muted-foreground">Foundation</p>
            <p className="text-base font-semibold">Dashboard Shell</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden max-w-52 text-right sm:block">
            <p className="truncate text-sm font-medium">{user.email}</p>
            <p className="text-xs capitalize text-muted-foreground">
              {user.role}
            </p>
          </div>
          <Button
            aria-label="Toggle theme"
            onClick={() => setTheme(nextTheme)}
            size="icon"
            variant="outline"
          >
            <Sun className="size-4 dark:hidden" />
            <Moon className="hidden size-4 dark:block" />
          </Button>
          <Button
            aria-label="Sign out"
            onClick={handleLogout}
            size="icon"
            variant="outline"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
