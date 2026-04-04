"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUser } from "@/context/user-context";
import { Copy, Check, LogOut } from "lucide-react";

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
  const { authenticated, logout } = usePrivy();
  const { user } = useUser();
  const { login } = useLogin({
    onComplete: () => {
      router.push("/onboarding");
    },
  });
  const [copied, setCopied] = useState(false);

  function handleLaunchApp() {
    if (!authenticated) {
      login();
      return;
    }
    router.push("/onboarding");
  }

  function copyAddress() {
    if (user?.seedAddress) {
      navigator.clipboard.writeText(user.seedAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const displayAddress = user?.seedAddress
    ? `${user.seedAddress.slice(0, 6)}...${user.seedAddress.slice(-4)}`
    : null;

  return (
    <nav className="fixed top-0 shrink-0 w-full h-16 z-50 bg-surface border-b border-outline-variant/10 shadow-[0_0_40px_rgba(227,27,35,0.08)]">
      <div className="flex justify-between items-center px-8 w-full max-w-[1920px] mx-auto h-full">
        <div className="text-3xl font-black text-primary-container tracking-tighter font-headline uppercase">
          Kondor
        </div>
        {showNavigation && (
          <div className="hidden md:flex items-center gap-8">
            <NavLink href="/dashboard" active={pathname.startsWith("/dashboard")}>
              Dashboard
            </NavLink>
            <NavLink href="/profile" active={pathname === "/profile"}>
              Profile
            </NavLink>
          </div>
        )}

        {authenticated && displayAddress ? (
          <div className="flex items-center gap-2">
            {/* Address chip */}
            <button
              onClick={copyAddress}
              className="group flex items-center gap-2.5 h-10 px-4 bg-surface-container border border-outline-variant/20 hover:border-primary-container/40 transition-all cursor-pointer"
            >
              <div className="size-2 bg-green-400 rounded-full" />
              {user?.ensSubdomain ? (
                <span className="font-headline font-bold text-sm text-on-surface tracking-tight">
                  {user.ensSubdomain}<span className="text-secondary-ds">.kondor.eth</span>
                </span>
              ) : (
                <code className="font-label text-xs text-on-surface tracking-wider">
                  {displayAddress}
                </code>
              )}
              {copied ? (
                <Check className="size-3.5 text-green-400" />
              ) : (
                <Copy className="size-3.5 text-secondary-container group-hover:text-secondary-ds transition-colors" />
              )}
            </button>

            {/* Logout */}
            <button
              onClick={() => logout()}
              className="flex items-center justify-center size-10 bg-surface-container border border-outline-variant/20 hover:border-primary-container/40 text-secondary-container hover:text-primary-container transition-all cursor-pointer"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <Button variant="primary" size="nav" onClick={handleLaunchApp}>
            Launch App
          </Button>
        )}
      </div>
    </nav>
  );
}
