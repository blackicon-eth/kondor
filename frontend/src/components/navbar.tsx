"use client";

import { usePathname, useRouter } from "next/navigation";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

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
          <div className="hidden md:flex items-center space-x-8 font-headline uppercase tracking-wider text-base">
            <a className="text-primary-container border-b-2 border-primary-container pb-1" href="#">
              Ecosystem
            </a>
            <a className="text-secondary-ds hover:text-white transition-colors" href="#">
              Security
            </a>
            <a className="text-secondary-ds hover:text-white transition-colors" href="#">
              Docs
            </a>
          </div>
        )}
        <Button variant="primary" size="nav" onClick={handleLaunchApp}>
          Launch App
        </Button>
      </div>
    </nav>
  );
}
