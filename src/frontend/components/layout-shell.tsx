"use client";

import { useState } from "react";
import type { User } from "next-auth";
import { AppSidebar, type SidebarTab } from "@/components/app-sidebar";
import {
    LayoutDashboardIcon,
    SettingsIcon,
    PlayIcon,
    BoxIcon,
} from "lucide-react";

function MockTabContent({
    icon: Icon,
    title,
    description,
}: {
    icon: typeof LayoutDashboardIcon;
    title: string;
    description: string;
}) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="rounded-2xl bg-muted/50 p-6">
                <Icon size={48} strokeWidth={1.5} />
            </div>
            <div className="text-center">
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                <p className="text-sm mt-1 max-w-sm">{description}</p>
            </div>
        </div>
    );
}

const tabContent: Record<Exclude<SidebarTab, "chat">, { icon: typeof LayoutDashboardIcon; title: string; description: string }> = {
    dashboard: {
        icon: LayoutDashboardIcon,
        title: "Dashboard",
        description: "Overview of your infrastructure, deployments, and resource usage.",
    },
    settings: {
        icon: SettingsIcon,
        title: "Settings",
        description: "Configure your workspace, cloud providers, and preferences.",
    },
    run: {
        icon: PlayIcon,
        title: "Run",
        description: "Execute Terraform plans, view logs, and manage deployments.",
    },
    "3d": {
        icon: BoxIcon,
        title: "3D View",
        description: "Visualize your infrastructure in an interactive 3D environment.",
    },
};

export function LayoutShell({
    user,
    children,
}: {
    user: User | undefined;
    children: React.ReactNode;
}) {
    const [activeTab, setActiveTab] = useState<SidebarTab>("chat");

    return (
        <div className="flex h-dvh">
            <AppSidebar user={user} activeTab={activeTab} onTabChange={setActiveTab} />
            <div className="flex-1 min-w-0">
                {activeTab === "chat" ? (
                    children
                ) : (
                    <MockTabContent {...tabContent[activeTab]} />
                )}
            </div>
        </div>
    );
}
