"use client";

import type { ComponentType } from "react";
import {
  ClipboardCheck,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebarStore } from "@/hooks/use-sidebar-store";
import type { AuthRole } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

const navigation = [
  {
    label: "Workspace",
    icon: LayoutDashboard,
    roles: ["admin", "editor", "viewer"],
  },
  {
    label: "Quality Review",
    icon: ClipboardCheck,
    roles: ["admin", "editor", "viewer"],
  },
  {
    label: "Administration",
    icon: Settings,
    roles: ["admin"],
  },
] satisfies Array<{
  label: string;
  icon: ComponentType<{ size?: number }>;
  roles: AuthRole[];
}>;

type SidebarProps = {
  role: AuthRole;
};

export function Sidebar({ role }: SidebarProps) {
  const { isOpen, toggle } = useSidebarStore();
  const visibleNavigation = navigation.filter((item) =>
    item.roles.includes(role),
  );

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={toggle}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-sidebar/80 px-4 py-5 text-sidebar-foreground shadow-[20px_0_80px_rgba(15,23,42,0.08)] backdrop-blur-2xl transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">DBL</p>
            <p className="text-lg font-semibold">QAD Portal</p>
          </div>
          <Button
            aria-label="Toggle sidebar"
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={toggle}
          >
            {isOpen ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeftOpen size={18} />
            )}
          </Button>
        </div>
        <nav className="mt-10 space-y-1">
          {visibleNavigation.map((item) => (
            <button
              className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              key={item.label}
              type="button"
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}
