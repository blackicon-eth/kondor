"use client";

import { useRouter } from "next/navigation";
import { TokenIcon } from "@/components/token-icon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const SUPPORTED_TOKENS = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "WBTC", name: "Wrapped Bitcoin" },
  { symbol: "LINK", name: "Chainlink" },
  { symbol: "UNI", name: "Uniswap" },
];

export default function AddTokenModal({
  open,
  onOpenChange,
  existingTokens,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingTokens: string[];
}) {
  const router = useRouter();
  const availableTokens = SUPPORTED_TOKENS.filter(
    (t) => !existingTokens.includes(t.symbol)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Token Policy</DialogTitle>
          <DialogDescription>
            Select a token to create a new automation policy for.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 pt-2">
          {availableTokens.map((token) => (
            <button
              key={token.symbol}
              onClick={() => {
                onOpenChange(false);
                router.push(`/new-policy/${token.symbol}`);
              }}
              className="flex items-center gap-3 px-4 py-3 bg-surface-container-high border border-outline-variant/15 hover:border-primary-container/40 hover:bg-surface-container-highest transition-all cursor-pointer group"
            >
              <TokenIcon symbol={token.symbol} size={40} />
              <div className="text-left">
                <div className="font-headline font-bold text-sm text-on-surface group-hover:text-primary-container transition-colors">
                  {token.symbol}
                </div>
                <div className="font-label text-[9px] uppercase tracking-widest text-secondary-ds">
                  {token.name}
                </div>
              </div>
            </button>
          ))}
        </div>

        {availableTokens.length === 0 && (
          <div className="text-center py-6 text-secondary-ds font-label text-xs uppercase tracking-widest">
            All supported tokens have policies
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
