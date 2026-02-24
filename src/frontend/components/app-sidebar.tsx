"use client";

import type { User } from "next-auth";
import { useState } from "react";
import {
  MessageSquareIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  PlayIcon,
  BoxIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { SidebarUserNav } from "./sidebar-user-nav";

export type SidebarTab = "chat" | "dashboard" | "settings" | "run" | "3d";

const toolItems: { id: SidebarTab; icon: typeof MessageSquareIcon; label: string }[] = [
  { id: "chat", icon: MessageSquareIcon, label: "Chat" },
  { id: "dashboard", icon: LayoutDashboardIcon, label: "Dashboard" },
  { id: "settings", icon: SettingsIcon, label: "Settings" },
  { id: "run", icon: PlayIcon, label: "Run" },
  { id: "3d", icon: BoxIcon, label: "3D View" },
];

export function AppSidebar({
  user,
  activeTab,
  onTabChange,
}: {
  user: User | undefined;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
}) {
  return (
    <div className="flex flex-col items-center w-[52px] border-r bg-muted/30 py-3 gap-1 shrink-0 h-dvh">
      {/* Tool icons */}
      <div className="flex flex-col items-center gap-1">
        {toolItems.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-10 w-10 rounded-xl transition-colors ${activeTab === item.id
                    ? "bg-accent text-accent-foreground"
                    : ""
                  }`}
                onClick={() => onTabChange(item.id)}
              >
                <item.icon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User avatar at bottom */}
      {user && (
        <div className="flex flex-col items-center">
          <SidebarUserNav user={user} />
        </div>
      )}
    </div>
  );
}
