"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/context/user-context";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function TestPage() {
  const { ready, authenticated, user: privyUser, getAccessToken, login, logout } = usePrivy();
  const { user, loading, completedOnboarding, completeOnboarding } = useUser();
  const [result, setResult] = useState<string>("");

  async function testAuth() {
    const token = await getAccessToken();
    if (!token) {
      setResult("No token available — are you logged in?");
      return;
    }

    const res = await fetch("/api/auth/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setResult(JSON.stringify(data, null, 2));
  }

  if (!ready) return <div className="p-8 text-on-surface">Loading...</div>;

  return (
    <div className="p-8 space-y-6 bg-surface min-h-screen text-on-surface font-body">
      <h1 className="text-2xl font-headline font-bold">Auth Test</h1>

      <div className="space-y-2">
        <p>Privy ready: {String(ready)}</p>
        <p>Authenticated: {String(authenticated)}</p>
        <p>User context loading: {String(loading)}</p>
        <p>Onboarded: {String(completedOnboarding)}</p>
        {privyUser && <p>Privy User ID: {privyUser.id}</p>}
        {user && <p>DB Seed Address: {user.seedAddress}</p>}
        {user && <p>ENS Subdomain: {user.ensSubdomain ?? "null"}</p>}
      </div>

      <div className="flex gap-4 flex-wrap">
        {!authenticated ? (
          <Button variant="primary" size="nav" onClick={login}>
            Login
          </Button>
        ) : (
          <>
            <Button variant="primary" size="nav" onClick={testAuth}>
              Test API Call
            </Button>
            <Button variant="outline" size="nav" onClick={() => completeOnboarding()}>
              Complete Onboarding
            </Button>
            <Button variant="outline" size="nav" onClick={logout}>
              Logout
            </Button>
          </>
        )}
      </div>

      {result && (
        <pre className="p-4 bg-surface-container-high text-sm font-mono whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  );
}
