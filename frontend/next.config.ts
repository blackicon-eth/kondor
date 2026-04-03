import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  transpilePackages: ["@kondor/shared"],
};

export default nextConfig;
