"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, Layers } from "lucide-react";
import AddTokenModal from "@/components/add-token-modal";
import { useUser } from "@/context/user-context";

export default function DashboardIndex() {
  const router = useRouter();
  const { userPolicies } = useUser();
  const [modalOpen, setModalOpen] = useState(false);

  const existingTokens = userPolicies?.tokens.map((t) => t.inputToken) ?? [];

  // Redirect to first token if policies exist
  useEffect(() => {
    if (existingTokens.length > 0) {
      router.replace(`/dashboard/${existingTokens[0]}`);
    }
  }, [existingTokens, router]);

  // If there are existing tokens, don't render (redirect is happening)
  if (existingTokens.length > 0) return null;

  // Empty state
  return (
    <div className="flex justify-center items-center w-full h-full">
      <motion.div
        className="flex flex-col items-center gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="size-16 rounded-full bg-surface-container-high border border-outline-variant/20 flex items-center justify-center">
          <Layers className="size-8 text-secondary-ds" />
        </div>
        <div className="text-center">
          <h2 className="font-headline font-bold text-2xl text-on-surface tracking-tight mb-2">
            No policies yet
          </h2>
          <p className="text-secondary-ds font-body text-sm max-w-sm">
            Create your first token policy to start automating your incoming crypto.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="h-12 px-8 bg-primary-container text-on-primary-container font-headline font-bold uppercase tracking-widest text-sm hover:bg-white hover:text-surface transition-all flex items-center gap-3 cursor-pointer"
        >
          <Plus className="size-4" />
          Create First Policy
        </button>
        <AddTokenModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          existingTokens={existingTokens}
        />
      </motion.div>
    </div>
  );
}
