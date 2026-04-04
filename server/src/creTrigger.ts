import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { config } from "./config.js";
import { fetchReportProcessedLogIndex } from "./reportReceipt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const httpWorkflowCwd = path.resolve(projectRoot, "workflows", "http-triggered");
const eventWorkflowCwd = path.resolve(projectRoot, "workflows", "event-triggered");
const eventWorkflowEnvPath = path.join(eventWorkflowCwd, ".env");

export interface CreResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** Parse tx hash from HTTP CRE logs (written by handler) or fallback regex. */
export function extractWriteReportTxHash(stdout: string, stderr: string): Hex | null {
  const blob = `${stdout}\n${stderr}`;
  const tagged = blob.match(/KONDOR_WRITE_REPORT_TX_HASH:(0x[a-fA-F0-9]{64})/);
  if (tagged) return tagged[1] as Hex;
  const legacy = blob.match(/writeReport SUCCESS:\s*(0x[a-fA-F0-9]{64})/);
  return legacy ? (legacy[1] as Hex) : null;
}

function runCre(
  cwd: string,
  extraArgs: string[],
  label: string
): Promise<CreResult> {
  return new Promise((resolve) => {
    const globals: string[] = [];
    if (existsSync(eventWorkflowEnvPath) && cwd === eventWorkflowCwd) {
      globals.push("-e", eventWorkflowEnvPath);
    }
    const proc = spawn(
      "cre",
      [
        ...globals,
        "workflow",
        "simulate",
        "handler",
        "--broadcast",
        "--non-interactive",
        "--trigger-index",
        "0",
        ...extraArgs,
        "--target",
        "staging-settings",
      ],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
      });
    });

    proc.on("error", (err) => {
      resolve({
        ok: false,
        stdout,
        stderr: `${stderr}\n${label} spawn error: ${err}`,
        exitCode: null,
      });
    });
  });
}

function runHttpCre(httpPayloadPath: string): Promise<CreResult> {
  return runCre(httpWorkflowCwd, ["--http-payload", httpPayloadPath], "http-cre");
}

function runEventCre(txHash: Hex, eventIndex: number): Promise<CreResult> {
  return runCre(eventWorkflowCwd, ["--evm-tx-hash", txHash, "--evm-event-index", String(eventIndex)], "event-cre");
}

export async function triggerCreWithPayload(payload: Record<string, unknown>): Promise<CreResult> {
  const tmpFile = path.join(os.tmpdir(), `kondor-cre-${Date.now()}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(payload), "utf8");
  try {
    return await runHttpCre(tmpFile);
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/**
 * After a successful HTTP CRE run, fetch the tx receipt on Sepolia, find `ReportProcessed` log index,
 * and run the event-triggered workflow with `--evm-tx-hash` / `--evm-event-index`.
 */
export async function chainEventWorkflowAfterHttp(httpResult: CreResult): Promise<void> {
  if (!config.autoChainEventCre) return;
  if (!httpResult.ok) return;

  const txHash = extractWriteReportTxHash(httpResult.stdout, httpResult.stderr);
  if (!txHash) {
    console.log("[cre:event-chain] No writeReport tx hash in CRE output; skip event workflow");
    return;
  }

  const registry = config.kondorRegistryAddress;
  if (!registry) {
    console.warn("[cre:event-chain] KONDOR_REGISTRY_ADDRESS unset; skip event workflow");
    return;
  }

  let logIndex: number;
  try {
    logIndex = await fetchReportProcessedLogIndex(config.sepoliaRpcUrl, txHash, registry);
  } catch (err) {
    console.error("[cre:event-chain] Failed to fetch tx receipt:", err);
    return;
  }

  if (logIndex < 0) {
    console.log(
      `[cre:event-chain] No ReportProcessed log from registry ${registry} in tx ${txHash}; skip event workflow`
    );
    return;
  }

  console.log(`[cre:event-chain] Running event CRE tx=${txHash} evm-event-index=${logIndex}`);
  const eventResult = await runEventCre(txHash, logIndex);
  if (eventResult.ok) {
    console.log(`[cre:event-chain] Event workflow completed (exit ${eventResult.exitCode})`);
  } else {
    console.error(`[cre:event-chain] Event workflow failed (exit ${eventResult.exitCode})`);
  }
  if (eventResult.stdout) console.log("[cre:event:stdout]", eventResult.stdout);
  if (eventResult.stderr) console.error("[cre:event:stderr]", eventResult.stderr);
}
