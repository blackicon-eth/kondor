"use client";

import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useContext, useState, type ReactNode } from "react";

/**
 * Freezes the Next.js layout router context so the exiting route keeps rendering
 * its own segment tree during AnimatePresence exit instead of swapping to the next page immediately.
 */
export function FrozenRouter({ children }: { children: ReactNode }) {
  const context = useContext(LayoutRouterContext);
  const [frozen] = useState(() => context);

  return (
    <LayoutRouterContext.Provider value={frozen}>{children}</LayoutRouterContext.Provider>
  );
}
