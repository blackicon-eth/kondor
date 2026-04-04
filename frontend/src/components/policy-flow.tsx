"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  Position,
  Handle,
  BackgroundVariant,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Coins,
  GitBranch,
  ArrowRight,
  TrendingUp,
  Landmark,
  Wallet,
  ShieldCheck,
  ChevronDown,
  Minus,
  Plus,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Token list ──────────────────────────────────────────────────────────────
const TOKENS = [
  { symbol: "ETH", name: "Ethereum", color: "#627EEA" },
  { symbol: "WBTC", name: "Wrapped Bitcoin", color: "#F7931A" },
  { symbol: "LINK", name: "Chainlink", color: "#2A5ADA" },
  { symbol: "UNI", name: "Uniswap", color: "#FF007A" },
] as const;

const OPERATORS = ["<", ">"] as const;

// ─── Types ───────────────────────────────────────────────────────────────────
export type OutcomeConfig = {
  swapToken: string;
  swapPct: number;
  aavePct: number;
  destPct: number;
};

export type PolicyConfig = {
  sourceToken: string;
  branchingEnabled: boolean;
  condition: {
    token: string;
    operator: "<" | ">";
    amount: number;
  };
  outcomeIf: OutcomeConfig;
  outcomeElse: OutcomeConfig;
  outcome: OutcomeConfig;
  destinationWallet: string;
  railgunWallet: string;
  privateMode: boolean;
};

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
          <div className="size-10 rounded-full bg-[#2775CA]/15 border border-[#2775CA]/30 flex items-center justify-center">
            <span className="text-[#2775CA] font-headline font-bold text-sm">$</span>
          </div>
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
        className="!bg-primary-container !border-0 !size-2"
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
          className="!bg-primary-container !border-0 !size-2"
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
          className="!bg-primary-container !border-0 !size-2"
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-primary-container !border-0 !size-2"
      />
      <NodeShell label="IF" sublabel="CONDITION" accent>
        <div className="flex items-center gap-3 min-w-[320px]">
          {/* Token selector */}
          <div className="relative">
            <select
              value={config.condition.token}
              onChange={(e) => onChange("token", e.target.value)}
              className="appearance-none bg-surface-container-high border border-outline-variant/20 text-on-surface font-headline font-bold text-sm px-3 py-2 pr-7 cursor-pointer focus:outline-none focus:border-primary-container/50 transition-colors"
            >
              {TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.symbol}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3 text-secondary-ds pointer-events-none" />
          </div>

          {/* Operator */}
          <select
            value={config.condition.operator}
            onChange={(e) => onChange("operator", e.target.value)}
            className="appearance-none bg-surface-container-high border border-outline-variant/20 text-primary-container font-headline font-bold text-lg px-3 py-1.5 w-12 text-center cursor-pointer focus:outline-none focus:border-primary-container/50 transition-colors"
          >
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>

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
        className="!bg-primary-container !border-0 !size-2"
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

  const total = outcome.swapPct + outcome.aavePct + outcome.destPct;
  const isValid = total === 100;

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-primary-container !border-0 !size-2"
      />
      <NodeShell label={label} sublabel={sublabel} accent={isValid} className="min-w-[300px]">
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
              <div className="relative">
                <select
                  value={outcome.swapToken}
                  onChange={(e) => onChange("swapToken", e.target.value)}
                  className="appearance-none bg-surface-container-high border border-outline-variant/20 text-on-surface font-headline font-bold text-xs px-2 py-1 pr-6 cursor-pointer focus:outline-none focus:border-primary-container/50 transition-colors"
                >
                  {TOKENS.map((t) => (
                    <option key={t.symbol} value={t.symbol}>
                      {t.symbol}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 size-2.5 text-secondary-ds pointer-events-none" />
              </div>
              <PctStepper value={outcome.swapPct} onChange={(v) => onChange("swapPct", v)} />
            </div>
          </div>

          <div className="h-px bg-outline-variant/10" />

          {/* AAVE row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Landmark className="size-4 text-[#B6509E]" />
              <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                Lend AAVE
              </span>
            </div>
            <PctStepper value={outcome.aavePct} onChange={(v) => onChange("aavePct", v)} />
          </div>

          <div className="h-px bg-outline-variant/10" />

          {/* Destination wallet row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-[#2775CA]" />
              <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                Dest. Wallet
              </span>
            </div>
            <div className="w-12 text-center font-headline font-bold text-sm text-on-surface">
              {outcome.destPct}%
            </div>
          </div>

          {/* Sum indicator */}
          <div
            className={`
              text-center font-label text-[9px] uppercase tracking-[0.2em] py-1.5 mt-1 transition-colors
              ${
                isValid
                  ? "text-green-400/80 bg-green-400/5 border border-green-400/10"
                  : "text-red-400/80 bg-red-400/5 border border-red-400/10"
              }
            `}
          >
            Total: {total}% {isValid ? "/ Valid" : `/ Must be 100%`}
          </div>
        </div>
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-primary-container !border-0 !size-2"
      />
    </div>
  );
}

// ─── Destination Node ────────────────────────────────────────────────────────
function DestinationNode({ data }: NodeProps) {
  const config = data.config as PolicyConfig;
  const onChange = data.onDestinationChange as (field: string, value: string | boolean) => void;

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-primary-container !border-0 !size-2"
      />
      <NodeShell label="DESTINATION" sublabel="OUTPUT" glowing>
        <div className="space-y-3 min-w-[260px]">
          {/* Address input */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {config.privateMode ? (
                <ShieldCheck className="size-4 text-green-400" />
              ) : (
                <Wallet className="size-4 text-[#2775CA]" />
              )}
              <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
                {config.privateMode ? "Railgun zkAddress" : "Wallet Address"}
              </span>
            </div>
            <input
              type="text"
              value={config.privateMode ? config.railgunWallet : config.destinationWallet}
              onChange={(e) =>
                onChange(config.privateMode ? "railgunWallet" : "destinationWallet", e.target.value)
              }
              placeholder={config.privateMode ? "0zk..." : "0x..."}
              className="w-full bg-surface-container-high border border-outline-variant/20 text-on-surface font-label text-xs px-3 py-2 placeholder:text-secondary-container focus:outline-none focus:border-primary-container/50 transition-colors"
            />
          </div>

          <div className="h-px bg-outline-variant/10" />

          {/* Privacy toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={config.privateMode}
              onCheckedChange={(checked) => onChange("privateMode", !!checked)}
            />
            <span className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
              Privacy mode
            </span>
          </label>
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
  swapToken: "ETH",
  swapPct: 25,
  aavePct: 25,
  destPct: 50,
};

export default function PolicyFlow() {
  const [config, setConfig] = useState<PolicyConfig>({
    sourceToken: "USDC",
    branchingEnabled: false,
    condition: { token: "ETH", operator: ">", amount: 3000 },
    outcomeIf: { ...defaultOutcome },
    outcomeElse: { swapToken: "ETH", swapPct: 0, aavePct: 100, destPct: 0 },
    outcome: { ...defaultOutcome },
    destinationWallet: "",
    railgunWallet: "",
    privateMode: false,
  });

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

        // Auto-balance destPct if swap or aave changed, cap total at 100
        if (field === "swapPct" || field === "aavePct") {
          let swapPct = field === "swapPct" ? (value as number) : current.swapPct;
          let aavePct = field === "aavePct" ? (value as number) : current.aavePct;
          if (swapPct + aavePct > 100) {
            if (field === "swapPct") swapPct = 100 - aavePct;
            else aavePct = 100 - swapPct;
          }
          updated.swapPct = swapPct;
          updated.aavePct = aavePct;
          updated.destPct = Math.max(0, 100 - swapPct - aavePct);
        }

        return { ...prev, [key]: updated };
      });
    },
    []
  );

  const updateDestination = useCallback((field: string, value: string | boolean) => {
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
  }, [config, toggleBranching, updateCondition, makeOutcomeUpdater, updateDestination]);

  return (
    <div className="w-full space-y-4">
      {/* Branching toggle */}
      <div className="inline-flex items-center gap-4 bg-surface-container px-5 py-3 border border-outline-variant/15">
        <div className="flex items-center gap-3 w-[300px]">
          <GitBranch
            className={`size-5 transition-colors ${config.branchingEnabled ? "text-primary-container" : "text-secondary-ds"}`}
          />
          <div>
            <div className="font-headline font-bold text-sm tracking-tight text-on-surface">
              Conditional Routing
            </div>
            <div className="font-label text-[10px] uppercase tracking-widest text-secondary-ds">
              {config.branchingEnabled
                ? "IF / ELSE enabled — route by condition"
                : "Direct mode — single outcome path"}
            </div>
          </div>
        </div>
        <Switch checked={config.branchingEnabled} onCheckedChange={toggleBranching} />
      </div>

      {/* Flow pane */}
      <div className="w-full h-[550px] relative">
        {/* Scanline overlay for aesthetic */}
        <div
          className="absolute inset-0 pointer-events-none z-10 opacity-[0.015]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(227,27,35,0.5) 2px, rgba(227,27,35,0.5) 3px)",
          }}
        />
        <ReactFlowProvider>
          <PolicyFlowInner nodes={nodes} edges={edges} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

function PolicyFlowInner({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      defaultViewport={{ x: 20, y: 20, zoom: 1 }}
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
        size={1}
        color="rgba(227, 27, 35, 0.08)"
      />
    </ReactFlow>
  );
}
