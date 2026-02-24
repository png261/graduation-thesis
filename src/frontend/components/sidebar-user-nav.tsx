"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { guestRegex } from "@/lib/constants";
import { LoaderIcon } from "./icons";
import { toast } from "./toast";

export function SidebarUserNav({ user }: { user: User }) {
  const router = useRouter();
  const { data, status } = useSession();
  const { setTheme, resolvedTheme } = useTheme();

  const isGuest = guestRegex.test(data?.user?.email ?? "");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center justify-center rounded-xl h-10 w-10 hover:bg-muted transition-colors"
          data-testid="user-nav-button"
        >
          {status === "loading" ? (
            <div className="size-6 animate-pulse rounded-full bg-zinc-500/30" />
          ) : (
            <Image
              alt={user.email ?? "User Avatar"}
              className="rounded-full"
              height={28}
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user.email || 'U')}&background=random&size=28`}
              width={28}
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        className="w-56"
        data-testid="user-nav-menu"
      >
        <div className="px-2 py-1.5 text-sm font-medium truncate">
          {isGuest ? "Guest" : user?.email}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          data-testid="user-nav-item-theme"
          onSelect={() =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          }
        >
          {`Toggle ${resolvedTheme === "light" ? "dark" : "light"} mode`}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild data-testid="user-nav-item-auth">
          <button
            className="w-full cursor-pointer"
            onClick={() => {
              if (status === "loading") {
                toast({
                  type: "error",
                  description:
                    "Checking authentication status, please try again!",
                });
                return;
              }

              if (isGuest) {
                router.push("/login");
              } else {
                signOut({
                  redirectTo: "/",
                });
              }
            }}
            type="button"
          >
            {isGuest ? "Login to your account" : "Sign out"}
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
