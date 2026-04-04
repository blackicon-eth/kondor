import Image from "next/image";

interface TokenIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function TokenIcon({ symbol, size = 24, className }: TokenIconProps) {
  return (
    <Image
      src={`/tokens/${symbol}.svg`}
      alt={symbol}
      width={size}
      height={size}
      className={className}
      unoptimized
    />
  );
}
