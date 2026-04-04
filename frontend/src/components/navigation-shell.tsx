"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useUser } from "@/context/user-context";
import { Loader2 } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { AnimatePresence, motion } from "framer-motion";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

const ONBOARDING_KEY = "kondor:onboarding";

export default function NavigationShell({ children }: { children: React.ReactNode }) {
  const { loading: userLoading } = useUser();
  const { authenticated } = usePrivy();
  const pathname = usePathname();
  const router = useRouter();

  // Onboarding state from localStorage (creates it if it doesn't exist)
  const completedOnboarding = useMemo(() => {
    if (typeof window === "undefined") return false;
    const value = localStorage.getItem(ONBOARDING_KEY);
    if (value === null) {
      localStorage.setItem(ONBOARDING_KEY, "false");
      return false;
    }
    return value === "true";
  }, []);

  // redirect to home if user is not authenticated and loading finished
  useEffect(() => {
    if (!userLoading) {
      // Safe guard for test page
      if (pathname === "/profile") {
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
            <motion.main
              key={`main-${pathname}`}
              className="flex justify-center items-start w-full py-16 h-[calc(100vh)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              {children}
            </motion.main>
            <Footer />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
