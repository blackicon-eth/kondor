"use client";

import { useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { UserProvider } from "@/context/user-context";
import NavigationShell from "@/components/navigation-shell";
import { MoneriumWrapper } from "@/components/monerium-wrapper";
import { MoneriumTokenSync } from "@/components/monerium-token-sync";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "google", "github"],
        appearance: {
          accentColor: "#E31B23",
        },
        embeddedWallets: {
          showWalletUIs: false,
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <UserProvider>
          <MoneriumWrapper>
            <MoneriumTokenSync />
            <NavigationShell>{children}</NavigationShell>
          </MoneriumWrapper>
        </UserProvider>
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </PrivyProvider>
  );
}
