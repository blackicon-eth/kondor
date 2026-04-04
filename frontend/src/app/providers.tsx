"use client";

import { useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { UserProvider } from "@/context/user-context";
import NavigationShell from "@/components/navigation-shell";
import { NuqsAdapter } from "nuqs/adapters/next";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <NuqsAdapter>
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "google", "github", "wallet"],
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
          <NavigationShell>{children}</NavigationShell>
        </UserProvider>
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </PrivyProvider>
    </NuqsAdapter>
  );
}
