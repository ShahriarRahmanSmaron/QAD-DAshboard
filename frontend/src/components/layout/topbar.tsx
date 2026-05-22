"use client";

import { Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useSidebarStore } from "@/hooks/use-sidebar-store";

export function Topbar() {
  const { setTheme, theme } = useTheme();
  const toggleSidebar = useSidebarStore((state) => state.toggle);
  const nextTheme = theme === "dark" ? "light" : "dark";

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
        <Button
          aria-label="Toggle theme"
          onClick={() => setTheme(nextTheme)}
          size="icon"
          variant="outline"
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>
      </div>
    </header>
  );
}
