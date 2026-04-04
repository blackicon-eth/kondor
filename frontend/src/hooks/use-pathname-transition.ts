"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * True only when `pathname` changed since the last committed layout (real client navigation).
 * False on first paint so Framer Motion does not run enter after SSR/hydration or loading→content.
 */
export function usePathnameTransition(pathname: string): boolean {
  const previousPathname = useRef<string | null>(null);

  useLayoutEffect(() => {
    previousPathname.current = pathname;
  }, [pathname]);

  // eslint-disable-next-line react-hooks/refs -- intentional "previous value during render" for transition gating
  return previousPathname.current !== null && previousPathname.current !== pathname;
}
