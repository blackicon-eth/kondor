"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useUser } from "@/context/user-context";
import { usePrivy } from "@privy-io/react-auth";
import ky from "ky";
import {
  Shield,
  Landmark,
  RotateCcw,
  ExternalLink,
  Lock,
  Loader2,
  ArrowDownToLine,
  Sparkles,
} from "lucide-react";

const RECOVERY_ENTRIES = [
  { address: "st_0x4f...92E1", amount: "4.821", token: "ETH" },
  { address: "st_0x91...C2A4", amount: "1,402", token: "USDC" },
  { address: "st_0xA4...00F2", amount: "0.952", token: "ETH" },
];

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

export default function Profile() {
  const { user, userZkAddress, userForwardTo, refetch } = useUser();
  const { user: privyUser, getAccessToken } = usePrivy();
  const [zkAddress, setZkAddress] = useState(userZkAddress ?? "");
  const [destinationWallet, setDestinationWallet] = useState(userForwardTo ?? "");
  const [updatingZkAddress, setUpdatingZkAddress] = useState(false);
  const [updatingDestinationWallet, setUpdatingDestinationWallet] = useState(false);

  const seedAddress = privyUser?.linkedAccounts.find(
    (a) => a.type === "wallet" && a.walletClientType === "privy"
  );

  async function handleUpdateZkAddress() {
    const trimmed = zkAddress.trim();
    if (!trimmed) {
      toast.error("Please enter a valid zkAddress");
      return;
    }
    if (!trimmed.startsWith("0zk")) {
      toast.error("Invalid zkAddress format — must start with 0zk");
      return;
    }
    if (!seedAddress || !("address" in seedAddress)) {
      toast.error("Wallet not available");
      return;
    }
    setUpdatingZkAddress(true);
    try {
      const token = await getAccessToken();
      await ky.put("/api/user/text-records", {
        json: { textRecords: { railgunAddress: trimmed } },
        headers: {
          Authorization: `Bearer ${token}`,
          "x-seed-address": seedAddress.address,
        },
      });
      await refetch();
      toast.success("zkAddress updated successfully");
    } catch (e) {
      toast.error("Failed to update zkAddress");
    } finally {
      setUpdatingZkAddress(false);
    }
  }

  async function handleUpdateDestinationWallet() {
    const trimmed = destinationWallet.trim();
    if (!trimmed) {
      toast.error("Please enter a valid wallet address");
      return;
    }
    if (!seedAddress || !("address" in seedAddress)) {
      toast.error("Wallet not available");
      return;
    }
    setUpdatingDestinationWallet(true);
    try {
      // Read the existing kondor-policy, update forwardTo, write it back
      const textRecords = JSON.parse(user?.textRecords || "{}");
      const policyStr = textRecords["kondor-policy"];
      if (!policyStr) {
        toast.error("No existing policy found");
        setUpdatingDestinationWallet(false);
        return;
      }

      const policy = JSON.parse(policyStr);
      policy.forwardTo = trimmed;

      const token = await getAccessToken();
      await ky.put("/api/user/text-records", {
        json: { textRecords: { "kondor-policy": JSON.stringify(policy) } },
        headers: {
          Authorization: `Bearer ${token}`,
          "x-seed-address": seedAddress.address,
        },
      });
      await refetch();
      toast.success("Destination wallet updated successfully");
    } catch (e) {
      toast.error("Failed to update destination wallet");
    } finally {
      setUpdatingDestinationWallet(false);
    }
  }

  return (
    <div className="flex justify-center items-start w-full h-full">
      <motion.div
        className="w-full max-w-[1650px] mx-auto px-8 py-12"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Header */}
        <motion.div variants={fadeUp} className="mb-10">
          <h1 className="text-6xl md:text-8xl font-headline font-black text-on-surface leading-[0.9] tracking-tighter mb-5">
            PROFILE<span className="text-primary-container">_</span>
          </h1>
          <p className="text-secondary-ds text-base font-body max-w-2xl leading-relaxed">
            Manage your Railgun zkAddress, link Monerium account for offramping, and initiate
            stealth asset recovery through the Kondor decentralized interface.
          </p>
        </motion.div>

        {/* Protocol Cards Row */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
          {/* Railgun Address — wider card */}
          <div className="lg:col-span-8 bg-surface-container border border-outline-variant/10 relative overflow-hidden">
            {/* Red left accent bar */}
            <div className="absolute top-0 left-0 w-1 h-full bg-primary-container" />

            {/* Decorative shield icon */}
            <div className="absolute top-6 right-6 opacity-[0.06]">
              <Shield className="size-28 text-primary-container" />
            </div>

            <div className="flex justify-between items-center w-full p-8 gap-10">
              {/* Railgun zkAddress section */}
              <div className="relative z-10 w-full">
                <h3 className="font-headline font-bold text-on-surface uppercase tracking-wider text-base mb-1">
                  Railgun zkAddress
                </h3>
                <p className="font-label text-[10px] uppercase tracking-widest text-secondary-container mb-6">
                  Your Privacy Layer
                </p>

                {/* zkAddress input + Update button */}
                <div className="flex flex-row justify-start gap-3 items-center">
                  <div className="flex items-center gap-3 bg-surface-container-lowest px-5 py-3.5 flex-1 border border-outline-variant/10 group">
                    <Lock className="size-4 text-secondary-container shrink-0" />
                    <input
                      type="text"
                      value={zkAddress}
                      onChange={(e) => setZkAddress(e.target.value)}
                      placeholder="0zk1a2b3c4d..."
                      className="w-full bg-transparent font-label text-sm text-on-surface tracking-wider placeholder:text-secondary-container focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleUpdateZkAddress}
                    disabled={updatingZkAddress || !zkAddress.trim()}
                    className="flex items-center justify-center gap-2 bg-primary-container text-on-primary-container px-4 py-3.5 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-white hover:text-surface transition-all cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary-container disabled:hover:text-on-primary-container"
                  >
                    Update
                    {updatingZkAddress ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Destination wallet section */}
              <div className="relative z-10 w-full">
                <h3 className="font-headline font-bold text-on-surface uppercase tracking-wider text-base mb-1">
                  Destination Wallet
                </h3>
                <p className="font-label text-[10px] uppercase tracking-widest text-secondary-container mb-6">
                  Your classic wallet address
                </p>

                {/* zkAddress input + Update button */}
                <div className="flex flex-row justify-start gap-3 items-center">
                  <div className="flex items-center gap-3 bg-surface-container-lowest px-5 py-3.5 flex-1 border border-outline-variant/10 group">
                    <Lock className="size-4 text-secondary-container shrink-0" />
                    <input
                      type="text"
                      value={destinationWallet}
                      onChange={(e) => setDestinationWallet(e.target.value)}
                      placeholder="0x1a2b3c4d..."
                      className="w-full bg-transparent font-label text-sm text-on-surface tracking-wider placeholder:text-secondary-container focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleUpdateDestinationWallet}
                    disabled={updatingDestinationWallet || !destinationWallet.trim()}
                    className="flex items-center justify-center gap-2 bg-primary-container text-on-primary-container px-4 py-3.5 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-white hover:text-surface transition-all cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary-container disabled:hover:text-on-primary-container"
                  >
                    Update
                    {updatingDestinationWallet ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Monerium — narrower card */}
          <div className="lg:col-span-4 bg-surface-container border border-outline-variant/10 relative overflow-hidden">
            {/* Red corner accent */}
            <div
              className="absolute top-0 right-0 w-20 h-20 bg-primary-container"
              style={{
                clipPath: "polygon(100% 0, 0 0, 100% 100%)",
              }}
            />
            <div className="absolute top-2.5 right-2.5 z-10">
              <ArrowDownToLine className="size-5 text-on-primary-container" />
            </div>

            <div className="relative z-10 p-8">
              <h3 className="font-headline font-bold text-on-surface uppercase tracking-wider text-base mb-3">
                Monerium
              </h3>
              <p className="text-secondary-ds text-sm font-body leading-relaxed mb-6">
                Bridge your on-chain assets with the European e-money ecosystem through secure IBAN
                integration.
              </p>
              <button className="flex items-center gap-2 w-full justify-center bg-surface-container-highest text-on-surface px-5 py-3 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-primary-container hover:text-on-primary-container transition-all cursor-pointer border border-outline-variant/10">
                <Landmark className="size-3.5" />
                Connect Monerium
              </button>
            </div>
          </div>
        </motion.div>

        {/* Funds Recovery */}
        <motion.div variants={fadeUp} className="mb-8">
          <div className="bg-surface-container border border-outline-variant/10 overflow-hidden">
            {/* Section header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-8 pt-8 pb-6 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-10 bg-primary-container" />
                <div>
                  <h3 className="font-headline font-bold text-on-surface uppercase tracking-wider text-base">
                    Funds Recovery
                  </h3>
                  <p className="font-label text-[10px] uppercase tracking-widest text-secondary-container">
                    Stealth Asset Management Terminal
                  </p>
                </div>
              </div>
              <button className="flex items-center gap-2 bg-primary-container text-on-primary-container px-5 py-2.5 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-white hover:text-surface transition-all cursor-pointer">
                <Sparkles className="size-3.5" />
                Recover All
              </button>
            </div>

            {/* Table */}
            <div className="px-8 pb-8">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-outline-variant/10">
                <div className="col-span-5 font-label text-[10px] uppercase tracking-widest text-secondary-container">
                  Stealth Addresses
                </div>
                <div className="col-span-4 font-label text-[10px] uppercase tracking-widest text-secondary-container">
                  Blocked Amounts
                </div>
                <div className="col-span-3 font-label text-[10px] uppercase tracking-widest text-secondary-container text-right">
                  Action
                </div>
              </div>

              {/* Table Rows */}
              {RECOVERY_ENTRIES.map((entry, i) => (
                <div
                  key={entry.address}
                  className={`grid grid-cols-12 gap-4 px-6 py-5 items-center group/row hover:bg-surface-container-low transition-colors ${
                    i < RECOVERY_ENTRIES.length - 1 ? "border-b border-outline-variant/10" : ""
                  }`}
                >
                  <div className="col-span-5 flex items-center gap-3">
                    <div className="size-2 bg-primary-container rounded-full shrink-0" />
                    <code className="font-label text-sm text-on-surface tracking-wider">
                      {entry.address}
                    </code>
                  </div>
                  <div className="col-span-4">
                    <span className="font-headline font-bold text-on-surface text-sm">
                      {entry.amount}
                    </span>
                    <span className="font-label text-xs text-secondary-ds ml-2 uppercase tracking-wider">
                      {entry.token}
                    </span>
                  </div>
                  <div className="col-span-3 flex justify-end">
                    <button className="flex items-center gap-1.5 text-primary-container font-label text-[11px] uppercase tracking-widest hover:text-white transition-colors cursor-pointer opacity-70 group-hover/row:opacity-100">
                      Recover
                      <ExternalLink className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
