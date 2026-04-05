"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import {
  useAuth,
  useAuthContext,
  useAddresses,
  useIBANs,
  useBalances,
} from "@monerium/sdk-react-provider";
import { Currency, AccountState, OrderState, OrderKind } from "@monerium/sdk";
import { useClearMoneriumSession } from "@/components/monerium-wrapper";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/context/user-context";
import {
  Landmark,
  LogOut,
  Loader2,
  CreditCard,
  Wallet,
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";

type Order = {
  id: string;
  kind: string;
  amount: string;
  currency: string;
  state: string;
  address: string;
  chain: string;
  memo?: string;
  counterpart: unknown;
  meta?: {
    placedAt?: string;
    processedAt?: string;
    txHashes?: string[];
  };
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } };

function BalanceCell({ address }: { address: string }) {
  const { data: balances } = useBalances({ address, chain: "sepolia", currencies: Currency.eur });
  const eur = balances?.balances?.find((b) => b.currency === "eur");
  return (
    <span className="font-label text-xs text-on-surface">
      {eur ? `${eur.amount} EURe` : "—"}
    </span>
  );
}

function SectionHeader({
  title,
  sub,
  onRefresh,
  refreshing,
}: {
  title: string;
  sub: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/10">
      <div className="flex items-center gap-2.5">
        <div className="w-0.5 h-6 bg-primary-container" />
        <div>
          <p className="font-headline font-bold text-on-surface text-xs uppercase tracking-wider">{title}</p>
          <p className="font-label text-[9px] uppercase tracking-widest text-secondary-container">{sub}</p>
        </div>
      </div>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 text-secondary-ds hover:text-on-surface transition-colors cursor-pointer disabled:opacity-40"
        >
          <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
          <span className="font-label text-[9px] uppercase tracking-widest">Refresh</span>
        </button>
      )}
    </div>
  );
}

export default function MoneriumPage() {
  const { isAuthorized, isLoading, authorize, disconnect } = useAuth();
  const { data: authCtx } = useAuthContext({});
  const profileId = authCtx?.defaultProfile;
  const { data: addresses, refetch: refetchAddresses } = useAddresses({ profile: profileId });
  const { data: ibans, refetch: refetchIbans } = useIBANs({ profile: profileId });
  const clearStoredSession = useClearMoneriumSession();
  const router = useRouter();
  const { user: privyUser, getAccessToken } = usePrivy();
  const { user } = useUser();

  const [infoVisible, setInfoVisible] = useState(false);
  const [orderList, setOrderList] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    if (!user?.ensSubdomain) return;
    setOrdersLoading(true);
    try {
      const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
      const res = await fetch(`${serverUrl}/monerium/orders-by-subdomain?ensSubdomain=${encodeURIComponent(user.ensSubdomain)}`);
      if (res.ok) {
        const data = await res.json() as { orders: Order[] };
        setOrderList(data.orders ?? []);
      }
    } finally {
      setOrdersLoading(false);
    }
  }, [user?.ensSubdomain]);

  useEffect(() => {
    if (isAuthorized) fetchOrders();
  }, [isAuthorized, fetchOrders]);

  const addressList = addresses?.addresses ?? [];
  const ibanList = ibans?.ibans ?? [];

  async function handleDisconnect() {
    try { await disconnect(); } catch { /* non-fatal */ }
    const wallet = privyUser?.linkedAccounts.find(
      (a) => a.type === "wallet" && (a.walletClientType === "privy" || a.walletClientType === "privy-v2")
    );
    if (wallet && "address" in wallet) {
      try {
        const token = await getAccessToken();
        await fetch("/api/monerium", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}`, "x-seed-address": wallet.address },
        });
      } catch { /* non-fatal */ }
    }
    clearStoredSession();
    router.push("/profile");
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center w-full h-full">
        <Loader2 className="size-5 text-primary-container animate-spin" />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="flex justify-center items-start w-full h-full">
        <motion.div className="w-full max-w-5xl mx-auto px-6 py-10" variants={stagger} initial="hidden" animate="show">
          <motion.div variants={fadeUp} className="mb-8">
            <h1 className="text-5xl font-headline font-black text-on-surface leading-none tracking-tighter mb-3">
              MONERIUM<span className="text-primary-container">_</span>
            </h1>
            <p className="text-secondary-ds text-sm font-body max-w-lg leading-relaxed">
              Connect your Monerium account to view IBANs, EURe balances, and manage your on-chain euro integration.
            </p>
          </motion.div>
          <motion.div variants={fadeUp}>
            <div className="bg-surface-container border border-outline-variant/10 p-7 max-w-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-14 h-14 bg-primary-container" style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }} />
              <div className="absolute top-2 right-2 z-10">
                <Landmark className="size-4 text-on-primary-container" />
              </div>
              <p className="font-headline font-bold text-on-surface uppercase tracking-wider text-sm mb-2">Not Connected</p>
              <p className="text-secondary-ds text-xs font-body leading-relaxed mb-5">
                Authenticate with Monerium to manage your European e-money account and IBAN integrations.
              </p>
              <button
                onClick={() => authorize()}
                className="flex items-center gap-2 w-full justify-center bg-primary-container text-on-primary-container px-4 py-2.5 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-white hover:text-surface transition-all cursor-pointer"
              >
                <Landmark className="size-3" />
                Connect Monerium
              </button>
            </div>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-start w-full h-full overflow-y-auto">
      <motion.div
        className="w-full max-w-6xl mx-auto px-6 py-8"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Header */}
        <motion.div variants={fadeUp} className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-headline font-black text-on-surface leading-none tracking-tighter">
              MONERIUM<span className="text-primary-container">_</span>
            </h1>
            <p className="text-secondary-ds text-xs font-body mt-1">
              Profile · IBANs · Balances · Orders
            </p>
          </div>
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 bg-surface-container border border-outline-variant/10 text-secondary-ds px-3 py-2 font-headline font-bold uppercase text-[10px] tracking-widest hover:border-primary-container hover:text-primary-container transition-all cursor-pointer"
          >
            <LogOut className="size-3" />
            Disconnect
          </button>
        </motion.div>

        {/* Account info strip */}
        <motion.div variants={fadeUp} className="mb-4">
          <div className="bg-surface-container border border-outline-variant/10 px-5 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-6 flex-1 min-w-0">
              {[
                { label: "Email", value: authCtx?.email ?? "—" },
                { label: "User ID", value: authCtx?.userId ?? "—" },
                { label: "Profile", value: authCtx?.defaultProfile ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} className="min-w-0">
                  <p className="font-label text-[9px] uppercase tracking-widest text-secondary-container">{label}</p>
                  <p className="font-label text-xs text-on-surface tracking-wide truncate max-w-[180px]">
                    {infoVisible ? value : "•".repeat(Math.min(value.length, 20))}
                  </p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setInfoVisible((v) => !v)}
              className="flex items-center gap-1 text-secondary-ds hover:text-on-surface transition-colors cursor-pointer shrink-0"
            >
              {infoVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              <span className="font-label text-[9px] uppercase tracking-widest">{infoVisible ? "Hide" : "Show"}</span>
            </button>
          </div>
        </motion.div>

        {/* IBANs + Balances side by side */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* IBANs */}
          <div className="bg-surface-container border border-outline-variant/10 overflow-hidden">
            <SectionHeader title="IBANs" sub="Linked accounts" onRefresh={() => refetchIbans()} />
            <div className="px-5 py-3">
              {ibanList.length === 0 ? (
                <p className="text-secondary-ds text-xs font-body py-2">No IBANs issued yet.</p>
              ) : (
                <div className="space-y-0">
                  <div className="grid grid-cols-12 gap-2 py-2 border-b border-outline-variant/10">
                    <div className="col-span-5 font-label text-[9px] uppercase tracking-widest text-secondary-container">IBAN</div>
                    <div className="col-span-4 font-label text-[9px] uppercase tracking-widest text-secondary-container">Address</div>
                    <div className="col-span-3 font-label text-[9px] uppercase tracking-widest text-secondary-container text-right">State</div>
                  </div>
                  {ibanList.map((iban, i) => (
                    <div key={i} className={`grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-container-low transition-colors ${i < ibanList.length - 1 ? "border-b border-outline-variant/10" : ""}`}>
                      <div className="col-span-5 flex items-center gap-2">
                        <CreditCard className="size-3 text-primary-container shrink-0" />
                        <code className="font-label text-[11px] text-on-surface tracking-wider">{iban.iban}</code>
                      </div>
                      <div className="col-span-4">
                        <code className="font-label text-[10px] text-secondary-ds">{iban.address.slice(0, 6)}…{iban.address.slice(-4)}</code>
                      </div>
                      <div className="col-span-3 flex justify-end">
                        <span className={`font-label text-[9px] uppercase tracking-widest px-1.5 py-0.5 ${iban.state === AccountState.approved ? "text-green-400 bg-green-400/10" : "text-secondary-ds bg-surface-container-highest"}`}>
                          {iban.state}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Balances */}
          <div className="bg-surface-container border border-outline-variant/10 overflow-hidden">
            <SectionHeader title="EURe Balances" sub="Sepolia testnet" onRefresh={() => refetchAddresses()} />
            <div className="px-5 py-3">
              {addressList.length === 0 ? (
                <p className="text-secondary-ds text-xs font-body py-2">No addresses linked yet.</p>
              ) : (
                <div>
                  <div className="grid grid-cols-12 gap-2 py-2 border-b border-outline-variant/10">
                    <div className="col-span-8 font-label text-[9px] uppercase tracking-widest text-secondary-container">Address</div>
                    <div className="col-span-4 font-label text-[9px] uppercase tracking-widest text-secondary-container text-right">Balance</div>
                  </div>
                  {addressList.map((addr, i) => (
                    <div key={i} className={`grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-container-low transition-colors ${i < addressList.length - 1 ? "border-b border-outline-variant/10" : ""}`}>
                      <div className="col-span-8 flex items-center gap-2">
                        <Wallet className="size-3 text-primary-container shrink-0" />
                        <code className="font-label text-[10px] text-on-surface">{addr.address.slice(0, 8)}…{addr.address.slice(-6)}</code>
                      </div>
                      <div className="col-span-4 flex justify-end">
                        <BalanceCell address={addr.address} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Orders */}
        <motion.div variants={fadeUp} className="mb-4">
          <div className="bg-surface-container border border-outline-variant/10 overflow-hidden">
            <SectionHeader title="Orders" sub="Redeem & issue history" onRefresh={fetchOrders} refreshing={ordersLoading} />
            <div className="px-5 py-3">
              {ordersLoading ? (
                <div className="flex items-center gap-2 py-3 text-secondary-ds text-xs font-body">
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </div>
              ) : orderList.length === 0 ? (
                <p className="text-secondary-ds text-xs font-body py-3">No orders yet.</p>
              ) : (
                <div>
                  <div className="grid grid-cols-12 gap-2 py-2 border-b border-outline-variant/10">
                    <div className="col-span-1 font-label text-[9px] uppercase tracking-widest text-secondary-container">Kind</div>
                    <div className="col-span-2 font-label text-[9px] uppercase tracking-widest text-secondary-container">Amount</div>
                    <div className="col-span-3 font-label text-[9px] uppercase tracking-widest text-secondary-container">Address</div>
                    <div className="col-span-3 font-label text-[9px] uppercase tracking-widest text-secondary-container">Date</div>
                    <div className="col-span-2 font-label text-[9px] uppercase tracking-widest text-secondary-container text-right">State</div>
                    <div className="col-span-1 font-label text-[9px] uppercase tracking-widest text-secondary-container text-right">Tx</div>
                  </div>
                  {orderList.map((order, i) => {
                    const isRedeem = order.kind === OrderKind.redeem;
                    const stateColor =
                      order.state === OrderState.processed ? "text-green-400" :
                      order.state === OrderState.rejected ? "text-primary-container" :
                      order.state === OrderState.pending ? "text-yellow-400" : "text-secondary-ds";
                    const StateIcon = order.state === OrderState.processed ? CheckCircle2 : order.state === OrderState.rejected ? XCircle : Clock;
                    const placedAt = order.meta?.placedAt
                      ? new Date(order.meta.placedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—";
                    const txHash = order.meta?.txHashes?.[0];
                    const sepoliaUrl = txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null;

                    return (
                      <div key={order.id} className={`grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-container-low transition-colors ${i < orderList.length - 1 ? "border-b border-outline-variant/10" : ""}`}>
                        <div className="col-span-1 flex items-center">
                          {isRedeem ? (
                            <span title="Redeem" className="inline-flex">
                              <ArrowUpRight className="size-3.5 text-primary-container shrink-0" />
                            </span>
                          ) : (
                            <span title="Issue" className="inline-flex">
                              <ArrowDownLeft className="size-3.5 text-green-400 shrink-0" />
                            </span>
                          )}
                        </div>
                        <div className="col-span-2">
                          <span className="font-label text-xs font-bold text-on-surface">{order.amount}</span>
                          <span className="font-label text-[9px] text-secondary-ds ml-1 uppercase">{order.currency}</span>
                        </div>
                        <div className="col-span-3">
                          <code className="font-label text-[10px] text-secondary-ds">
                            {order.address.slice(0, 6)}…{order.address.slice(-4)}
                          </code>
                        </div>
                        <div className="col-span-3">
                          <span className="font-label text-[10px] text-secondary-ds">{placedAt}</span>
                        </div>
                        <div className="col-span-2 flex justify-end items-center gap-1">
                          <StateIcon className={`size-3 shrink-0 ${stateColor}`} />
                          <span className={`font-label text-[9px] uppercase tracking-widest ${stateColor}`}>{order.state}</span>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          {sepoliaUrl ? (
                            <a href={sepoliaUrl} target="_blank" rel="noopener noreferrer" className="text-secondary-ds hover:text-primary-container transition-colors" title={txHash}>
                              <ArrowUpRight className="size-3" />
                            </a>
                          ) : <span className="text-outline-variant/30 font-label text-[9px]">—</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
