"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import PolicyFlow from "@/components/policy-flow";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TOKENS = ["USDC", "WBTC", "LINK", "UNI"] as const;

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export default function Dashboard() {
  const [selectedToken, setSelectedToken] = useState<(typeof TOKENS)[number]>("USDC");

  function handlePolicyUpdate(policy: unknown) {
    console.log("[Dashboard] Policy updated:", JSON.stringify(policy, null, 2));
    toast.success("Policy updated successfully");
  }

  return (
    <div className="flex justify-center items-start w-full h-full">
      <motion.div
        className="w-full max-w-[1500px] mx-auto px-8 py-12 flex flex-col gap-8"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Header */}
        <motion.div variants={fadeUp} className="flex items-start justify-between w-full">
          <div>
            <h1 className="text-6xl md:text-8xl font-headline font-black text-on-surface leading-[0.9] tracking-tighter mb-5">
              DASHBOARD<span className="text-primary-container">_</span>
            </h1>
            <p className="text-secondary-ds text-base font-body max-w-2xl leading-relaxed">
              Review and manage your assets policies.
            </p>
          </div>

          {/* Token select */}
          <Select value={selectedToken} onValueChange={(v) => setSelectedToken(v as (typeof TOKENS)[number])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {TOKENS.map((token) => (
                <SelectItem key={token} value={token}>
                  {token}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </motion.div>

        {/* Main HUD Panel */}
        <motion.div variants={fadeUp} className="relative">
          {/* HUD frame corners */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary-container/40 pointer-events-none z-20" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-primary-container/40 pointer-events-none z-20" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-primary-container/40 pointer-events-none z-20" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-primary-container/40 pointer-events-none z-20" />

          {/* Policy Flow Board */}
          <div className="bg-surface-container-lowest border border-outline-variant/15 p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedToken}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                <PolicyFlow onConfirm={handlePolicyUpdate} inputToken={selectedToken} />
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
