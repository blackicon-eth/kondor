"use client";

import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";

export default function NavigationShell({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated && pathname !== "/") {
      router.replace("/");
    }
  }, [ready, authenticated, pathname, router]);

  if (!ready) return null;

  if (!authenticated && pathname !== "/") return null;

  return <>{children}</>;
}
