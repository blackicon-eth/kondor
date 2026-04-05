"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  Position,
  Handle,
  BackgroundVariant,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  GitBranch,
  ArrowRight,
  TrendingUp,
  Landmark,
  ShieldCheck,
  ChevronDown,
  Minus,
  Plus,
  Loader2,
  Trash2,
} from "lucide-react";
import { TokenIcon } from "@/components/token-icon";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildPolicy,
  buildTextRecord,
  policyToFlowConfig,
  type OutcomeConfig,
  type FlowConfig,
} from "@/lib/policies/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useUser } from "@/context/user-context";
import { encryptPolicy, ENCRYPTION_SIGN_MESSAGE } from "@/lib/policies/encrypt";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import ky from "ky";
import { toast } from "sonner";

// TODO: replace with real Monerium IBAN from user context once integration lands.
const MOCK_MONERIUM_IBAN = "GB29 NWBK 6016 1331 9268 19";

// ─── Token list ──────────────────────────────────────────────────────────────
const TOKENS = [
  { symbol: "WETH", name: "Wrapped Ether", color: "#627EEA" },
  { symbol: "WBTC", name: "Wrapped Bitcoin", color: "#F7931A" },
  { symbol: "LINK", name: "Chainlink", color: "#2A5ADA" },
  { symbol: "UNI", name: "Uniswap", color: "#FF007A" },
] as const;

// PolicyConfig is the same as FlowConfig from lib/policies/utils
type PolicyConfig = FlowConfig;

// ─── Shared node wrapper ─────────────────────────────────────────────────────
function NodeShell({
  children,
  label,
  sublabel,
  accent = false,
  glowing = false,
  className = "",
}: {
  children: React.ReactNode;
  label: string;
  sublabel?: string;
  accent?: boolean;
  glowing?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`
        nodrag nopan nowheel relative border bg-surface-container
        ${accent ? "border-primary-container/40" : "border-outline-variant/20"}
        ${glowing ? "shadow-[0_0_30px_rgba(227,27,35,0.12)]" : ""}
        ${className}
      `}
    >
      <div
        className={`
          px-3 py-1.5 border-b font-label text-[9px] uppercase tracking-[0.25em] flex items-center gap-2
          ${accent ? "border-primary-container/30 text-primary-container" : "border-outline-variant/15 text-secondary-ds"}
        `}
      >
        <span>{label}</span>
        {sublabel && (
          <span className="text-secondary-container ml-auto font-normal tracking-wider">
            {sublabel}
          </span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Token Source Node ───────────────────────────────────────────────────────
function TokenSourceNode({ data }: NodeProps) {
  const config = data.config as PolicyConfig;
  return (
    <div className="relative">
      <NodeShell label="SOURCE" sublabel="TRIGGER" accent glowing>
        <div className="flex items-center gap-3 min-w-[200px]">
          <TokenIcon symbol={config.sourceToken} size={48} />
          <div>
            <div className="font-headline font-bold text-on-surface text-lg tracking-tight">
              {config.sourceToken}
            </div>
            <div className="font-label text-[10px] text-secondary-ds uppercase tracking-widest">
              Incoming
            </div>
          </div>
        </div>
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        className="bg-primary-container! border-0! size-2!"
      />
    </div>
  );
}

// ─── Condition Node (IF) ─────────────────────────────────────────────────────
function ConditionNode({ data }: NodeProps) {
  const config = data.config as PolicyConfig;
  const onChange = data.onConditionChange as (field: string, value: string | number) => void;
  const variant = (data.variant as "if" | "else") ?? "if";

  if (variant === "else") {
    return (
      <div className="relative">
        <Handle
          type="target"
          position={Position.Left}
          className="bg-primary-container! border-0! size-2!"
        />
        <NodeShell label="ELSE" sublabel="FALLBACK" className="min-w-[240px]">
          <div className="flex items-center gap-2 text-secondary-ds">
            <ArrowRight className="size-4" />
            <span className="font-label text-xs uppercase tracking-widest">
              All other conditions
            </span>
          </div>
        </NodeShell>
        <Handle
          type="source"
          position={Position.Right}
          className="bg-primary-container! border-0! size-2!"
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="bg-primary-container! border-0! size-2!"
      />
      <NodeShell label="IF" sublabel="CONDITION" accent>
        <div className="flex items-center gap-3 min-w-[320px]">
          {/* Token selector */}
          <Select value={config.condition.token} onValueChange={(v) => v && onChange("token", v)}>
            <SelectTrigger size="sm" className="bg-surface-container-high">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOKENS.map((t) => (
                <SelectItem key={t.symbol} value={t.symbol}>
                  {t.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Operator */}
          <button
            onClick={() => onChange("operator", config.condition.operator === "<" ? ">" : "<")}
            className="bg-surface-container-high border border-outline-variant/20 text-primary-container font-headline font-bold text-lg px-3 py-1.5 w-12 text-center cursor-pointer hover:border-primary-container/50 transition-all"
          >
            <ChevronDown
              className={`size-5 mx-auto transition-transform duration-300 ${config.condition.operator === "<" ? "rotate-90" : "-rotate-90"}`}
            />
          </button>

          {/* Amount */}
          <div className="flex items-center bg-surface-container-high border border-outline-variant/20 px-3 py-1.5">
            <span className="text-secondary-ds font-headline text-sm mr-1">$</span>
            <input
              type="number"
              value={config.condition.amount}
              onChange={(e) => onChange("amount", Number(e.target.value))}
              className="bg-transparent text-on-surface font-headline font-bold text-sm w-20 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              min={0}
              step={1}
            />
          </div>
        </div>
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        className="bg-primary-container! border-0! size-2!"
      />
    </div>
  );
}

// ─── Percentage stepper ──────────────────────────────────────────────────────
function PctStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(0, value - 5))}
        disabled={disabled || value <= 0}
        className="size-5 flex items-center justify-center bg-surface-container-high border border-outline-variant/20 text-secondary-ds hover:text-on-surface hover:border-outline-variant/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <Minus className="size-2.5" />
      </button>
      <div className="w-12 text-center font-headline font-bold text-sm text-on-surface">
        {value}%
      </div>
      <button
        onClick={() => onChange(Math.min(100, value + 5))}
        disabled={disabled || value >= 100}
        className="size-5 flex items-center justify-center bg-surface-container-high border border-outline-variant/20 text-secondary-ds hover:text-on-surface hover:border-outline-variant/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <Plus className="size-2.5" />
      </button>
    </div>
  );
}

// ─── Outcome Node ────────────────────────────────────────────────────────────
function OutcomeNode({ data }: NodeProps) {
  const outcome = data.outcome as OutcomeConfig;
  const onChange = data.onOutcomeChange as (field: string, value: string | number) => void;
  const label = (data.label as string) ?? "OUTCOME";
  const sublabel = (data.sublabel as string) ?? "ALLOCATION";
  const sourceToken = (data.sourceToken as string) ?? "";
  const offrampMode = (data.offrampMode as boolean) ?? false;

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="bg-primary-container! border-0! size-2!"
      />
      <NodeShell label={label} sublabel={sublabel} accent className="min-w-[300px]">
        {offrampMode ? (
          <div className="space-y-3">
            {/* Locked offramp row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Landmark className="size-4 text-[#D4AF37]" />
                <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                  Offramp → EURe
                </span>
              </div>
              <div className="w-12 text-center font-headline font-bold text-sm text-on-surface">
                100%
              </div>
            </div>

            <div className="text-center font-label text-[9px] uppercase tracking-[0.2em] py-1.5 mt-1 text-green-400/80 bg-green-400/5 border border-green-400/10">
              Total: 100% / Valid
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Swap row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-[#627EEA]" />
                <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                  Swap
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={outcome.swapToken}
                  onValueChange={(v) => v && onChange("swapToken", v)}
                >
                  <SelectTrigger size="sm" className="bg-surface-container-high">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOKENS.map((t) => (
                      <SelectItem key={t.symbol} value={t.symbol}>
                        {t.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <PctStepper value={outcome.swapPct} onChange={(v) => onChange("swapPct", v)} />
              </div>
            </div>

            <div className="h-px bg-outline-variant/10" />

            {/* Remaining (source token) row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-[5px]">
                <TokenIcon symbol={sourceToken} size={24} className="-ml-1" />
                <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                  {sourceToken || "Remaining"}
                </span>
              </div>
              <div className="w-12 text-center font-headline font-bold text-sm text-on-surface">
                {outcome.destPct}%
              </div>
            </div>

            {/* Sum indicator */}
            <div className="text-center font-label text-[9px] uppercase tracking-[0.2em] py-1.5 mt-1 text-green-400/80 bg-green-400/5 border border-green-400/10">
              Total: 100% / Valid
            </div>
          </div>
        )}
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        className="bg-primary-container! border-0! size-2!"
      />
    </div>
  );
}

// ─── Destination Node ────────────────────────────────────────────────────────
function DestinationNode({ data }: NodeProps) {
  const config = data.config as PolicyConfig;
  const onChange = data.onDestinationChange as (field: string, value: string) => void;

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="bg-primary-container! border-0! size-2!"
      />
      <NodeShell label="DESTINATION" sublabel="OUTPUT" glowing>
        <div className="space-y-3 min-w-[260px]">
          {config.offrampMode ? (
            // Monerium IBAN (read-only, from user's Monerium account)
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Landmark className="size-4 text-[#D4AF37]" />
                <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                  Monerium IBAN
                </span>
              </div>
              <div className="w-full bg-surface-container-high border border-outline-variant/20 text-on-surface font-label text-xs px-3 py-2">
                {config.moneriumIban || "—"}
              </div>
            </div>
          ) : (
            // Railgun zkAddress
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="size-4 text-green-400" />
                <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                  Railgun zkAddress
                </span>
              </div>
              <input
                type="text"
                value={config.railgunWallet}
                onChange={(e) => onChange("railgunWallet", e.target.value)}
                placeholder="0zk..."
                className="w-full bg-surface-container-high border border-outline-variant/20 text-on-surface font-label text-xs px-3 py-2 placeholder:text-secondary-container focus:outline-none focus:border-primary-container/50 transition-colors"
              />
            </div>
          )}
        </div>
      </NodeShell>
    </div>
  );
}

// ─── Custom edge styles ──────────────────────────────────────────────────────
const edgeDefaults = {
  style: { stroke: "rgba(227, 27, 35, 0.3)", strokeWidth: 2 },
  animated: true,
};

// ─── Node type registry ──────────────────────────────────────────────────────
const nodeTypes = {
  tokenSource: TokenSourceNode,
  condition: ConditionNode,
  outcome: OutcomeNode,
  destination: DestinationNode,
};

// ─── Main Component ──────────────────────────────────────────────────────────
const defaultOutcome: OutcomeConfig = {
  swapToken: "WETH",
  swapPct: 25,
  offrampPct: 0,
  destPct: 75,
};

const offrampOutcome: OutcomeConfig = {
  swapToken: "WETH",
  swapPct: 0,
  offrampPct: 100,
  destPct: 0,
};

export default function PolicyFlow({
  onConfirm,
  onDelete,
  ensName = "",
  inputToken = "USDC",
  height = "550px",
  showDelete = false,
}: {
  onConfirm?: (policy: ReturnType<typeof buildPolicy>) => void;
  onDelete?: () => void;
  ensName?: string;
  inputToken?: string;
  height?: string;
  showDelete?: boolean;
}) {
  const { wallets } = useWallets();
  const { user: privyUser, getAccessToken } = usePrivy();
  const { refetch, userPolicies, userZkAddress } = useUser();
  const [saving, setSaving] = useState(false);

  const [config, setConfig] = useState<PolicyConfig>(() => {
    if (userPolicies) {
      const fromPolicy = policyToFlowConfig(userPolicies, inputToken, userZkAddress, MOCK_MONERIUM_IBAN);
      if (fromPolicy) return fromPolicy;
    }
    const offrampMode = userPolicies?.isOfframp ?? false;
    const initialOutcome = offrampMode ? offrampOutcome : defaultOutcome;
    return {
      sourceToken: inputToken,
      branchingEnabled: false,
      condition: { token: "WETH", operator: ">", amount: 3000 },
      outcomeIf: { ...initialOutcome },
      outcomeElse: { ...initialOutcome },
      outcome: { ...initialOutcome },
      railgunWallet: userZkAddress || "",
      moneriumIban: MOCK_MONERIUM_IBAN,
      offrampMode,
    };
  });

  // Sync config when userPolicies becomes available
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (initialized || !userPolicies) return;
    const fromPolicy = policyToFlowConfig(userPolicies, inputToken, userZkAddress, MOCK_MONERIUM_IBAN);
    if (fromPolicy) {
      setConfig(fromPolicy);
      setInitialized(true);
    }
  }, [userPolicies, inputToken, initialized, userZkAddress]);

  // Prefill wallet addresses when context values arrive (for new tokens without an existing policy)
  useEffect(() => {
    if (initialized) return;
    setConfig((prev) => ({
      ...prev,
      railgunWallet: userZkAddress || "",
      moneriumIban: MOCK_MONERIUM_IBAN,
    }));
  }, [userZkAddress, initialized]);

  const toggleBranching = useCallback(() => {
    setConfig((prev) => ({ ...prev, branchingEnabled: !prev.branchingEnabled }));
  }, []);

  const updateCondition = useCallback((field: string, value: string | number) => {
    setConfig((prev) => ({
      ...prev,
      condition: { ...prev.condition, [field]: value },
    }));
  }, []);

  const makeOutcomeUpdater = useCallback(
    (key: "outcome" | "outcomeIf" | "outcomeElse") => (field: string, value: string | number) => {
      setConfig((prev) => {
        const current = prev[key];
        const updated = { ...current, [field]: value };

        // Auto-balance destPct when swap changes. Offramp isn't part of per-token actions
        // anymore (it's expressed via the user-level isOfframp flag), so it's always 0 here.
        if (field === "swapPct") {
          const swapPct = Math.min(100, Math.max(0, value as number));
          updated.swapPct = swapPct;
          updated.offrampPct = 0;
          updated.destPct = 100 - swapPct;
        }

        return { ...prev, [key]: updated };
      });
    },
    []
  );

  const updateDestination = useCallback((field: string, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ─── Build nodes & edges dynamically ────────────────────────────────────
  const { nodes, edges } = useMemo(() => {
    const n: Node[] = [];
    const e: Edge[] = [];

    const Y_CENTER = 160;
    const Y_IF = 20;
    const Y_ELSE = 320;

    // Source node — always present
    n.push({
      id: "source",
      type: "tokenSource",
      position: { x: 0, y: Y_CENTER - 40 },
      data: { config },
      draggable: false,
    });

    if (config.branchingEnabled) {
      // IF condition
      n.push({
        id: "condition-if",
        type: "condition",
        position: { x: 320, y: Y_IF - 10 },
        data: { config, onConditionChange: updateCondition, variant: "if" },
        draggable: false,
      });

      // ELSE condition
      n.push({
        id: "condition-else",
        type: "condition",
        position: { x: 320, y: Y_ELSE },
        data: { config, variant: "else" },
        draggable: false,
      });

      // Outcome IF
      n.push({
        id: "outcome-if",
        type: "outcome",
        position: { x: 720, y: Y_IF - 40 },
        data: {
          outcome: config.outcomeIf,
          onOutcomeChange: makeOutcomeUpdater("outcomeIf"),
          label: "OUTCOME",
          sublabel: "IF TRUE",
          sourceToken: config.sourceToken,
          offrampMode: config.offrampMode,
        },
        draggable: false,
      });

      // Outcome ELSE
      n.push({
        id: "outcome-else",
        type: "outcome",
        position: { x: 720, y: Y_ELSE - 30 },
        data: {
          outcome: config.outcomeElse,
          onOutcomeChange: makeOutcomeUpdater("outcomeElse"),
          label: "OUTCOME",
          sublabel: "IF FALSE",
          sourceToken: config.sourceToken,
          offrampMode: config.offrampMode,
        },
        draggable: false,
      });

      // Destination
      n.push({
        id: "destination",
        type: "destination",
        position: { x: 1120, y: Y_CENTER - 50 },
        data: { config, onDestinationChange: updateDestination },
        draggable: false,
      });

      // Edges
      e.push(
        { id: "e-source-if", source: "source", target: "condition-if", ...edgeDefaults },
        { id: "e-source-else", source: "source", target: "condition-else", ...edgeDefaults },
        { id: "e-if-outcome", source: "condition-if", target: "outcome-if", ...edgeDefaults },
        { id: "e-else-outcome", source: "condition-else", target: "outcome-else", ...edgeDefaults },
        { id: "e-outcomeif-dest", source: "outcome-if", target: "destination", ...edgeDefaults },
        { id: "e-outcomeelse-dest", source: "outcome-else", target: "destination", ...edgeDefaults }
      );
    } else {
      // Single outcome
      n.push({
        id: "outcome",
        type: "outcome",
        position: { x: 320, y: Y_CENTER - 80 },
        data: {
          outcome: config.outcome,
          onOutcomeChange: makeOutcomeUpdater("outcome"),
          label: "OUTCOME",
          sublabel: "ALLOCATION",
          sourceToken: config.sourceToken,
          offrampMode: config.offrampMode,
        },
        draggable: false,
      });

      // Destination
      n.push({
        id: "destination",
        type: "destination",
        position: { x: 720, y: Y_CENTER - 50 },
        data: { config, onDestinationChange: updateDestination },
        draggable: false,
      });

      e.push(
        { id: "e-source-outcome", source: "source", target: "outcome", ...edgeDefaults },
        { id: "e-outcome-dest", source: "outcome", target: "destination", ...edgeDefaults }
      );
    }

    return { nodes: n, edges: e };
  }, [config, updateCondition, makeOutcomeUpdater, updateDestination]);

  // TODO: remove this test handler before shipping.
  function handleTestLog() {
    try {
      const existingTokens = userPolicies?.tokens ?? [];
      const policy = buildPolicy(config, existingTokens);
      console.log("[TEST] kondor-policy (plaintext) that would be written:", policy);
    } catch (e) {
      console.error("[TEST] Failed to build policy:", e);
    }
  }

  async function handleConfirm() {
    const wallet = wallets.find((w) => w.walletClientType === "privy");
    if (!wallet) return;

    const privyWallet = privyUser?.linkedAccounts.find(
      (a) => a.type === "wallet" && a.walletClientType === "privy"
    );
    if (!privyWallet || !("address" in privyWallet)) return;

    setSaving(true);
    try {
      const existingTokens = userPolicies?.tokens ?? [];
      const policy = buildPolicy(config, existingTokens);
      const signature = await wallet.sign(ENCRYPTION_SIGN_MESSAGE);
      const crePublicKey = process.env.NEXT_PUBLIC_CRE_PUBLIC_KEY!;
      const encrypted = encryptPolicy(policy, signature, crePublicKey);
      const textRecord = buildTextRecord(encrypted, ensName, config.railgunWallet);

      const token = await getAccessToken();
      await ky.put("/api/user/text-records", {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-seed-address": privyWallet.address,
        },
        json: { textRecords: textRecord },
      });

      await refetch();
      onConfirm?.(policy);
    } catch (e) {
      console.error("[Policy] Save failed:", e);
      toast.error("Failed to save policy");
    } finally {
      setSaving(false);
    }
  }

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const hasExistingPolicy = userPolicies?.tokens.some((t) => t.inputToken === inputToken) ?? false;

  async function handleDelete() {
    const wallet = wallets.find((w) => w.walletClientType === "privy");
    if (!wallet) return;

    const privyWallet = privyUser?.linkedAccounts.find(
      (a) => a.type === "wallet" && a.walletClientType === "privy"
    );
    if (!privyWallet || !("address" in privyWallet)) return;

    setDeleting(true);
    try {
      const remainingTokens = (userPolicies?.tokens ?? []).filter(
        (t) => t.inputToken !== inputToken
      );
      const policy = buildPolicy(config, remainingTokens);
      // Override tokens to only keep the remaining ones (buildPolicy would re-add the current one)
      policy.tokens = remainingTokens;

      const signature = await wallet.sign(ENCRYPTION_SIGN_MESSAGE);
      const crePublicKey = process.env.NEXT_PUBLIC_CRE_PUBLIC_KEY!;
      const encrypted = encryptPolicy(policy, signature, crePublicKey);
      const textRecord = buildTextRecord(encrypted, ensName, config.railgunWallet);

      const token = await getAccessToken();
      await ky.put("/api/user/text-records", {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-seed-address": privyWallet.address,
        },
        json: { textRecords: textRecord },
      });

      await refetch();
      setDeleteModalOpen(false);
      toast.success(`${inputToken} policy deleted`);
      onDelete?.();
    } catch (e) {
      console.error("[Policy] Delete failed:", e);
      toast.error("Failed to delete policy");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="w-full space-y-4">
      {/* Top bar */}
      <div className="w-full flex items-center justify-between">
        {/* Branching toggle — visible but disabled in offramp mode (branching is pointless
            when every outcome is forced to 100% offramp) */}
        <div
          className={`inline-flex items-center gap-4 bg-surface-container px-5 py-3 border border-outline-variant/15 transition-opacity duration-300 ${
            config.offrampMode ? "opacity-40 pointer-events-none" : "opacity-100"
          }`}
        >
          <div className="flex items-center gap-3 w-[300px]">
            <GitBranch
              className={`size-5 transition-colors ${config.branchingEnabled ? "text-primary-container" : "text-secondary-ds"}`}
            />
            <div>
              <div className="font-headline font-bold text-sm tracking-tight text-on-surface">
                Conditional Routing
              </div>
              <div className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                {config.offrampMode
                  ? "Disabled in offramp mode"
                  : config.branchingEnabled
                    ? "IF / ELSE enabled — route by condition"
                    : "Direct mode — single outcome path"}
              </div>
            </div>
          </div>
          <Switch
            checked={config.branchingEnabled}
            onCheckedChange={toggleBranching}
            disabled={config.offrampMode}
          />
        </div>

        {/* Confirm buttons */}
        <div className="flex items-center gap-3">
          {showDelete && hasExistingPolicy && (userPolicies?.tokens.length ?? 0) > 1 && (
            <button
              onClick={() => setDeleteModalOpen(true)}
              className="size-12 flex items-center justify-center bg-surface-container-high border border-outline-variant/20 text-secondary-ds hover:text-red-400 hover:border-red-400/30 transition-all cursor-pointer"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          {/* TODO: remove this test button before shipping. */}
          <button
            onClick={handleTestLog}
            disabled={saving || config.offrampMode || !config.railgunWallet.trim()}
            className="hidden h-12 px-6 bg-surface-container-high border border-outline-variant/20 text-secondary-ds font-label text-[10px] uppercase tracking-widest hover:text-on-surface hover:border-outline-variant/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-secondary-ds disabled:hover:border-outline-variant/20"
          >
            [TEST] Log Text Record
          </button>
          {config.offrampMode ? (
            // Status placeholder: editing disabled, offramp is enforced at policy level.
            <div
              className="relative h-12 flex items-center gap-3 bg-surface-container-high border border-[#D4AF37]/30 pl-4 pr-8"
              style={{ clipPath: "polygon(0 0, 100% 0, 97% 100%, 0% 100%)" }}
            >
              {/* Solid gold left stripe with glow */}
              <div
                className="absolute inset-y-0 left-0 w-1 bg-[#D4AF37]"
                style={{ boxShadow: "0 0 12px rgba(212, 175, 55, 0.6)" }}
              />
              {/* Pulsing LED */}
              <div className="relative flex items-center justify-center size-3 ml-1">
                <div className="absolute size-3 rounded-full bg-[#D4AF37]/25 animate-ping" />
                <div
                  className="relative size-1.5 rounded-full bg-[#D4AF37]"
                  style={{ boxShadow: "0 0 6px rgba(212, 175, 55, 0.9)" }}
                />
              </div>
              <Landmark className="size-4 text-[#D4AF37] shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="font-headline font-bold text-[13px] uppercase tracking-widest text-on-surface">
                  Offramp Mode Active
                </span>
                <span className="font-label text-[9px] uppercase tracking-[0.2em] text-[#D4AF37]/70">
                  Policies locked at user level
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={saving || !config.railgunWallet.trim()}
              className="h-12 px-8 bg-primary-container text-on-primary-container font-headline font-bold uppercase tracking-widest text-sm hover:bg-white hover:text-surface transition-all flex items-center gap-3 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary-container disabled:hover:text-on-primary-container"
            >
              Confirm Policy
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {inputToken} Policy</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the {inputToken} automation policy? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={() => setDeleteModalOpen(false)}
              className="h-10 px-6 bg-surface-container-high border border-outline-variant/20 text-secondary-ds font-headline font-bold uppercase text-[11px] tracking-widest hover:text-on-surface hover:border-outline-variant/40 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="h-10 px-6 bg-red-500/20 border border-red-500/30 text-red-400 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-red-500/30 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Flow pane */}
      <div className="relative border border-outline-variant/15" style={{ height }}>
        {/* Scanline overlay for aesthetic */}
        <div
          className="absolute inset-0 pointer-events-none z-10 opacity-[0.015]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(227,27,35,0.5) 2px, rgba(227,27,35,0.5) 3px)",
          }}
        />
        <ReactFlowProvider>
          <PolicyFlowInner
            nodes={nodes}
            edges={edges}
            fit={!config.branchingEnabled}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

function PolicyFlowInner({
  nodes,
  edges,
  fit,
}: {
  nodes: Node[];
  edges: Edge[];
  fit: boolean;
}) {
  const { zoomIn, zoomOut, fitView, setViewport } = useReactFlow();
  const mountedRef = useRef(false);

  // When the layout is sparse (branching off or offramp mode) center it and zoom in.
  // When branching is on the flow has twice as many nodes, so use the default viewport.
  // Skip animation on first mount (ReactFlow's fitView prop handles initial placement).
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (fit) {
      fitView({ padding: 0.15, duration: 400 });
    } else {
      setViewport({ x: 20, y: 50, zoom: 1 }, { duration: 400 });
    }
  }, [fit, fitView, setViewport]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 20, y: 50, zoom: 1 }}
        fitView={fit}
        fitViewOptions={{ padding: 0.15 }}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
        minZoom={0.5}
        maxZoom={1.5}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="rgba(227, 27, 35, 0.25)"
        />
      </ReactFlow>
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1">
        <button
          onClick={() => zoomOut({ duration: 200 })}
          className="size-8 flex items-center justify-center bg-surface-container border border-outline-variant/20 text-secondary-ds hover:text-on-surface hover:border-outline-variant/40 transition-colors cursor-pointer"
        >
          <Minus className="size-4" />
        </button>
        <button
          onClick={() => zoomIn({ duration: 200 })}
          className="size-8 flex items-center justify-center bg-surface-container border border-outline-variant/20 text-secondary-ds hover:text-on-surface hover:border-outline-variant/40 transition-colors cursor-pointer"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </>
  );
}
