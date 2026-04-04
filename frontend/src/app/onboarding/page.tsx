"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { usePrivy } from "@privy-io/react-auth";
import ky from "ky";
import { useUser } from "@/context/user-context";
import {
  Fingerprint,
  GitBranch,
  CheckCircle,
  AtSign,
  ArrowRight,
  Loader2,
  Check,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { PolicyJson } from "@/lib/policies/utils";
import PolicyFlow from "@/components/policy-flow";

const steps = [
  { id: "identity", label: "Identity", icon: Fingerprint },
  { id: "policy", label: "Policy", icon: GitBranch },
  { id: "complete", label: "Complete", icon: CheckCircle },
];

export default function Onboarding() {
  const [subdomain, setSubdomain] = useState("");
  const [registering, setRegistering] = useState(false);
  const { user: privyUser, getAccessToken } = usePrivy();
  const { user, refetch, completeOnboarding } = useUser();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(user?.ensSubdomain ? 1 : 0);

  // TODO: Replace mock with actual DB write — encrypt policy and save to user's text record
  async function handlePolicyConfirm(policy: PolicyJson) {
    toast.success("Policy saved successfully!");
    await new Promise((r) => setTimeout(r, 1500));
    setCurrentStep(2);
  }

  async function handleRegister() {
    if (!subdomain.trim()) return;

    const wallet = privyUser?.linkedAccounts.find(
      (a) => a.type === "wallet" && a.walletClientType === "privy"
    );
    if (!wallet || !("address" in wallet)) return;

    setRegistering(true);
    try {
      const token = await getAccessToken();
      await ky
        .post("/api/user/ens", {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-seed-address": wallet.address,
          },
          json: { ensSubdomain: subdomain.trim() },
        })
        .json();
      await refetch();
      await new Promise((r) => setTimeout(r, 2000));
      toast.success(`${subdomain.trim()}.kondor.eth registered!`);
      setCurrentStep(1);
    } catch (e) {
      const err = e as { response?: Response };
      if (err.response) {
        const body = (await err.response.json()) as { error?: string };
        toast.error(body.error ?? "Registration failed");
      } else {
        toast.error("Registration failed");
      }
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="flex overflow-hidden gap-20 w-full h-full">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-surface flex-col py-8 space-y-6">
        <div className="px-8 mb-4">
          <div className="font-label font-medium uppercase text-[11px] tracking-widest text-secondary-container">
            PHASE_01
          </div>
          <div className="text-primary-container font-bold font-headline tracking-tight text-2xl">
            ONBOARDING
          </div>
        </div>

        <nav className="flex flex-col space-y-2">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isActive = i === currentStep;
            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 py-3 font-label font-medium uppercase text-[13px] tracking-widest ${
                  isActive
                    ? "text-primary-container font-bold border-l-4 border-primary-container pl-4"
                    : "text-secondary-container pl-5"
                }`}
              >
                <Icon className="size-6" />
                {step.label}
              </div>
            );
          })}
        </nav>

        <div className="mt-auto px-8">
          <button className="text-primary-container font-label font-medium uppercase text-[10px] tracking-widest hover:underline">
            Help Center
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex justify-start items-start w-full overflow-y-auto overflow-x-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {currentStep === 0 && (
            <motion.div
              key="identity"
              className="max-w-5xl py-8 min-h-full flex flex-col"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* Editorial Layout */}
              <div className="grid grid-cols-12 gap-8 items-start mb-18">
                <div className="col-span-12">
                  <div
                    className="inline-block bg-primary-container text-on-primary-container px-3 py-1 text-[10px] font-label uppercase tracking-[0.2em] mb-6"
                    style={{ clipPath: "polygon(0 0, 100% 0, 92% 100%, 0% 100%)" }}
                  >
                    Step 01 / Phase_01
                  </div>
                  <h1 className="text-6xl md:text-8xl font-headline font-black text-on-surface leading-[0.9] tracking-tighter mb-8">
                    CLAIM YOUR <br />
                    <span className="text-primary-container">KONDOR</span> IDENTITY
                  </h1>
                  <p className="text-secondary-ds text-lg font-body max-w-lg leading-relaxed">
                    Your .kondor.eth domain is more than a name. It is your cryptographically
                    secured signature across the entire Kondor ecosystem.
                  </p>
                </div>
              </div>

              {/* Registration Input */}
              <section className="bg-surface-container p-10 relative">
                {/* Dot grid decoration */}
                <div
                  className="absolute inset-0 opacity-[0.03] pointer-events-none"
                  style={{
                    backgroundImage: "radial-gradient(#e31b23 1px, transparent 1px)",
                    backgroundSize: "20px 20px",
                  }}
                />

                <div className="relative z-10">
                  <div className="flex flex-col md:flex-row gap-6 items-end">
                    <div className="flex-1 w-full">
                      <label className="block font-label text-[10px] uppercase tracking-widest text-secondary-ds mb-4">
                        Desired ENS Subdomain
                      </label>
                      <div className="relative flex items-center bg-surface-container-lowest h-20 group">
                        <AtSign className="ml-6 w-7 h-7 text-primary-container shrink-0" />
                        <input
                          type="text"
                          value={subdomain}
                          onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
                          placeholder="alice"
                          className="w-full bg-transparent border-none text-4xl font-headline font-bold text-on-surface placeholder:text-surface-container-highest focus:ring-0 focus:outline-none px-4 h-full lowercase"
                        />
                        <div className="pr-6 text-2xl font-headline font-light text-secondary-ds whitespace-nowrap">
                          .kondor.eth
                        </div>
                        <div className="absolute bottom-0 left-0 h-[2px] bg-primary-container w-full transition-all duration-300 group-focus-within:h-[4px]" />
                      </div>
                    </div>

                    <button
                      onClick={handleRegister}
                      disabled={registering || !subdomain.trim()}
                      className="h-20 px-12 bg-primary-container text-on-primary-container font-headline font-bold uppercase tracking-widest text-lg hover:bg-white hover:text-surface transition-all flex items-center gap-3 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary-container disabled:hover:text-on-primary-container"
                    >
                      Register
                      {registering ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <ArrowRight className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>
              </section>
            </motion.div>
          )}
          {currentStep === 1 && (
            <motion.div
              key="policy"
              className="w-[98%] pt-8 min-h-full flex flex-col"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mb-8">
                <div
                  className="inline-block bg-primary-container text-on-primary-container px-3 py-1 text-[10px] font-label uppercase tracking-[0.2em] mb-6"
                  style={{ clipPath: "polygon(0 0, 100% 0, 92% 100%, 0% 100%)" }}
                >
                  Step 02 / Phase_01
                </div>
                <h1 className="text-5xl md:text-7xl font-headline font-black text-on-surface leading-[0.9] tracking-tighter mb-4">
                  DESIGN YOUR
                  <span className="text-primary-container">&nbsp;POLICY</span>
                </h1>
                <p className="text-secondary-ds text-lg font-body max-w-lg leading-relaxed">
                  Define how incoming tokens are routed — set conditions, allocations, and
                  destinations for your automated strategy.
                </p>
              </div>

              <div className="relative">
                {/* HUD frame corners */}
                <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary-container/40 pointer-events-none z-20" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-primary-container/40 pointer-events-none z-20" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-primary-container/40 pointer-events-none z-20" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-primary-container/40 pointer-events-none z-20" />

                <div className="flex bg-surface-container-lowest border border-outline-variant/15 p-3">
                  <PolicyFlow onConfirm={handlePolicyConfirm} ensName={user?.ensSubdomain ?? ""} />
                </div>
              </div>
            </motion.div>
          )}
          {currentStep === 2 && (
            <motion.div
              key="complete"
              className="w-full h-[calc(70vh)] flex flex-col items-center justify-center -translate-x-24"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex flex-col items-center gap-8">
                {/* Pulsing check */}
                <motion.div
                  className="relative flex items-center justify-center"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="absolute size-28 rounded-full bg-green-500/10 animate-ping" />
                  <div className="absolute size-24 rounded-full bg-green-500/5" />
                  <div className="relative size-20 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                    <Check className="size-10 text-green-400" strokeWidth={3} />
                  </div>
                </motion.div>

                {/* Heading */}
                <motion.div
                  className="flex flex-col items-center gap-4 mt-4"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.4 }}
                >
                  <h1 className="text-5xl md:text-7xl font-headline font-black text-on-surface leading-[0.9] tracking-tighter text-center">
                    YOU&apos;RE ALL SET
                  </h1>
                  <p className="text-secondary-ds text-lg font-body max-w-md leading-relaxed text-center">
                    Your <span className="text-primary-container font-bold">KONDOR</span> identity
                    is claimed and your policy is configured. Welcome to the ecosystem.
                  </p>
                </motion.div>

                {/* Dashboard button */}
                <motion.button
                  onClick={async () => {
                    completeOnboarding();
                    router.push("/dashboard/USDC");
                  }}
                  className="mt-4 h-14 px-10 bg-primary-container text-on-primary-container font-headline font-bold uppercase tracking-widest text-base hover:bg-white hover:text-surface transition-all flex items-center gap-3 cursor-pointer"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  Go to Dashboard
                  <ArrowRight className="size-5" />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
