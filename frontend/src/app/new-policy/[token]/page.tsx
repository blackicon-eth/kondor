"use client";

import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import PolicyFlow from "@/components/policy-flow";
import { useUser } from "@/context/user-context";
import { toast } from "sonner";

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

export default function NewPolicy() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const { user } = useUser();

  function handlePolicyConfirm() {
    toast.success(`${token} policy created!`);
    router.push(`/dashboard/${token}`);
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
            <div className="flex items-center gap-4 mb-5">
              <h1 className="text-6xl md:text-8xl font-headline font-black text-on-surface leading-[0.9] tracking-tighter">
                NEW POLICY<span className="text-primary-container">_</span>
              </h1>
            </div>
            <p className="text-secondary-ds text-base font-body max-w-2xl leading-relaxed">
              Configure your automation policy for incoming {token} tokens.
            </p>
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
            <PolicyFlow
              onConfirm={handlePolicyConfirm}
              inputToken={token}
              ensName={user?.ensSubdomain ?? ""}
              height="570px"
            />
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
