import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const workflowCwd = path.resolve(projectRoot, "workflows", "http-triggered");

export interface CreResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runCre(httpPayloadPath: string): Promise<CreResult> {
  return new Promise((resolve) => {
    const proc = spawn(
      "cre",
      [
        "workflow",
        "simulate",
        "handler",
        "--non-interactive",
        "--trigger-index",
        "0",
        "--http-payload",
        httpPayloadPath,
        "--target",
        "staging-settings",
      ],
      {
        cwd: workflowCwd,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
      });
    });
  });
}

export async function triggerCreWithPayload(payload: Record<string, unknown>): Promise<CreResult> {
  const tmpFile = path.join(os.tmpdir(), `kondor-cre-${Date.now()}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(payload), "utf8");
  try {
    return await runCre(tmpFile);
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}
