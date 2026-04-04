import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  transpilePackages: ["@kondor/shared"],
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "motion",
      "@privy-io/react-auth",
    ],
  },
};

export default nextConfig;
