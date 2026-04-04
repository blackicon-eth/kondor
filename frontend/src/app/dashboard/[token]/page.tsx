"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import PolicyFlow from "@/components/policy-flow";
import AddTokenModal from "@/components/add-token-modal";
import { useUser } from "@/context/user-context";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SUPPORTED_TOKENS = ["USDC", "WBTC", "LINK", "UNI"];

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

export default function DashboardToken() {
  const router = useRouter();
  const { token: urlToken } = useParams<{ token: string }>();
  const { user, userPolicies } = useUser();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState(urlToken);

  const existingTokens = userPolicies?.tokens.map((t) => t.inputToken) ?? [];
  const allTokensHavePolicies = SUPPORTED_TOKENS.every((t) => existingTokens.includes(t));

  const activeToken = existingTokens.includes(selectedToken)
    ? selectedToken
    : (existingTokens[0] ?? "");

  function handleTokenChange(token: string) {
    setSelectedToken(token);
    window.history.replaceState(null, "", `/dashboard/${token}`);
  }

  function handlePolicyUpdate() {
    toast.success("Policy updated successfully");
  }

  function handlePolicyDelete() {
    const remaining = existingTokens.filter((t) => t !== activeToken);
    if (remaining.length > 0) {
      setSelectedToken(remaining[0]);
      window.history.replaceState(null, "", `/dashboard/${remaining[0]}`);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="flex justify-center items-start w-full h-full">
      <motion.div
        className="w-full max-w-[1650px] mx-auto px-8 py-12 flex flex-col gap-8"
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
              Review and manage your token policies.
            </p>
          </div>

          {/* Token select + Add button */}
          <div className="flex items-center gap-2">
            <Select value={activeToken} onValueChange={handleTokenChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {existingTokens.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              onClick={() => setModalOpen(true)}
              disabled={allTokensHavePolicies}
              className="size-10 flex items-center justify-center bg-surface-container-high border border-outline-variant/15 text-secondary-ds hover:text-primary-container hover:border-primary-container/30 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-secondary-ds disabled:hover:border-outline-variant/15"
            >
              <Plus className="size-4" />
            </button>
          </div>
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
                key={activeToken}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                <PolicyFlow
                  onConfirm={handlePolicyUpdate}
                  onDelete={handlePolicyDelete}
                  inputToken={activeToken}
                  ensName={user?.ensSubdomain ?? ""}
                  height="570px"
                  showDelete
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>

      <AddTokenModal open={modalOpen} onOpenChange={setModalOpen} existingTokens={existingTokens} />
    </div>
  );
}
