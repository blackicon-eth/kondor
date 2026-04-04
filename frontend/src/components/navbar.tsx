"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navEase = [0.22, 1, 0.36, 1] as const;

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="relative inline-block px-0.5 pt-0.5 pb-1.5 outline-offset-4"
    >
      <motion.span
        className={cn(
          "relative z-10 inline-block font-headline uppercase tracking-wider text-base transition-colors duration-200",
          active ? "text-primary-container" : "text-secondary-ds hover:text-white"
        )}
        initial={false}
        animate={{ y: active ? -4 : 0 }}
        transition={{
          y: {
            type: "spring",
            stiffness: 380,
            damping: 32,
            delay: 0.22,
          },
        }}
      >
        {children}
      </motion.span>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 mx-auto h-0.5 max-w-full rounded-full bg-primary-container"
        style={{ originX: 0.5 }}
        initial={false}
        animate={{
          scaleX: active ? 1 : 0,
          opacity: active ? 1 : 0,
        }}
        transition={{
          duration: 0.28,
          ease: navEase,
        }}
      />
    </Link>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const showNavigation = pathname !== "/" && pathname !== "/onboarding";
  const { authenticated } = usePrivy();
  const { login } = useLogin({
    onComplete: () => {
      router.push("/onboarding");
    },
  });

  function handleLaunchApp() {
    if (!authenticated) {
      login();
      return;
    }
    router.push("/onboarding");
  }

  return (
    <nav className="fixed top-0 shrink-0 w-full h-16 z-50 bg-surface border-b border-outline-variant/10 shadow-[0_0_40px_rgba(227,27,35,0.08)]">
      <div className="flex justify-between items-center px-8 w-full max-w-[1920px] mx-auto h-full">
        <div className="text-3xl font-black text-primary-container tracking-tighter font-headline uppercase">
          Kondor
        </div>
        {showNavigation && (
          <div className="hidden md:flex items-center gap-8">
            <NavLink href="/dashboard" active={pathname === "/dashboard"}>
              Dashboard
            </NavLink>
            <NavLink href="/profile" active={pathname === "/profile"}>
              Profile
            </NavLink>
          </div>
        )}
        <Button variant="primary" size="nav" onClick={handleLaunchApp}>
          Launch App
        </Button>
      </div>
    </nav>
  );
}
