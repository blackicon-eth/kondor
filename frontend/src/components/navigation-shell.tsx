"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUser } from "@/context/user-context";
import { Loader2 } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { AnimatePresence, motion } from "framer-motion";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { FrozenRouter } from "@/components/frozen-router";
import { usePathnameTransition } from "@/hooks/use-pathname-transition";

export default function NavigationShell({ children }: { children: React.ReactNode }) {
  const { loading: userLoading, completedOnboarding } = useUser();
  const { authenticated } = usePrivy();
  const pathname = usePathname();
  const router = useRouter();
  const shouldAnimatePage = usePathnameTransition(pathname);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // redirect to home if user is not authenticated and loading finished
  useEffect(() => {
    if (!userLoading) {
      // Safe guard for test page
      if (pathname === "/test") {
        return;
      }

      // Redirect to home if user is not authenticated
      if (!authenticated && pathname !== "/") {
        router.replace("/");
        return;
      }

      // Redirect to onboarding if user has not completed onboarding and is not on the onboarding page
      if (!completedOnboarding && pathname !== "/onboarding" && pathname !== "/") {
        router.replace("/onboarding");
        return;
      }

      // If the user completed onboarding and is on the onboarding page, redirect to dashboard
      if (completedOnboarding && pathname === "/onboarding") {
        router.replace("/dashboard");
        return;
      }
    }
  }, [userLoading, authenticated, pathname, router, completedOnboarding]);

  return (
    <div className="size-full bg-surface">
      <AnimatePresence mode="wait">
        {userLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="flex justify-center items-center h-screen w-full bg-surface"
          >
            <Loader2 className="size-20 animate-spin text-primary-container" />
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="flex justify-center items-center h-full w-full bg-surface"
          >
            <Navbar />
            <AnimatePresence
              mode="wait"
              initial={false}
              onExitComplete={() => {
                window.scrollTo(0, 0);
              }}
            >
              <motion.main
                key={pathname}
                className="flex justify-center items-start w-full py-16 h-[calc(100vh)]"
                initial={shouldAnimatePage ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                <FrozenRouter>{children}</FrozenRouter>
              </motion.main>
            </AnimatePresence>
            <Footer />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
