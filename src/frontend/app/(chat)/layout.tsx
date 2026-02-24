import Script from "next/script";
import { Suspense } from "react";
import { DataStreamProvider } from "@/components/data-stream-provider";
import { LayoutShell } from "@/components/layout-shell";
import { auth } from "../(auth)/auth";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="beforeInteractive"
      />
      <DataStreamProvider>
        <Suspense fallback={<div className="flex h-dvh" />}>
          <LayoutInner>{children}</LayoutInner>
        </Suspense>
      </DataStreamProvider>
    </>
  );
}

async function LayoutInner({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <TooltipProvider>
      <LayoutShell user={session?.user}>
        {children}
      </LayoutShell>
    </TooltipProvider>
  );
}
