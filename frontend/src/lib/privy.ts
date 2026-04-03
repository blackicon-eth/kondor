import { verifyAccessToken } from "@privy-io/node";
import { createRemoteJWKSet } from "jose";
import { env } from "./env";

const jwks = createRemoteJWKSet(
  new URL(`https://auth.privy.io/api/v1/apps/${env.PRIVY_APP_ID}/jwks.json`)
);

export async function verifyAuth(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    const result = await verifyAccessToken({
      access_token: token,
      app_id: env.PRIVY_APP_ID,
      verification_key: jwks,
    });
    return result.user_id;
  } catch (e) {
    console.error("[privy] Token verification failed:", e);
    return null;
  }
}
