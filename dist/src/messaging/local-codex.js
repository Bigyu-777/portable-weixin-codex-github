import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { logger } from "../util/logger.js";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 6000;
function resolveCommand() {
    const configured = process.env.OPENCLAW_WEIXIN_CODEX_COMMAND?.trim();
    if (configured) {
        return { command: configured, args: [] };
    }
    return {
        command: process.platform === "win32" ? "codex.cmd" : "codex",
        args: [],
    };
}
function resolveWorkdir() {
    const configured = process.env.OPENCLAW_WEIXIN_CODEX_WORKDIR?.trim();
    return configured ? path.resolve(configured) : process.cwd();
}
function resolveTimeoutMs() {
    const raw = Number(process.env.OPENCLAW_WEIXIN_CODEX_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw > 0)
        return raw;
    return DEFAULT_TIMEOUT_MS;
}
function trimOutput(text, maxChars = DEFAULT_OUTPUT_LIMIT) {
    const normalized = text.trim();
    if (!normalized)
        return "";
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, maxChars)}\n\n[truncated ${normalized.length - maxChars} chars]`;
}
export async function runLocalCodex(params) {
    const prompt = params.prompt.trim();
    if (!prompt) {
        return {
            ok: false,
            summary: "Codex prompt is empty.",
            stdout: "",
            stderr: "",
            exitCode: null,
            timedOut: false,
            outputFile: "",
        };
    }
    const { command, args: commandArgs } = resolveCommand();
    const workdir = resolveWorkdir();
    const timeoutMs = resolveTimeoutMs();
    const outputFile = path.join(os.tmpdir(), `openclaw-weixin-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    const args = [
        ...commandArgs,
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--output-last-message",
        outputFile,
        "--cd",
        workdir,
        prompt,
    ];
    logger.info(`[weixin] launching local codex in ${workdir}`);
    return await new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: workdir,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let settled = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("error", (err) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            logger.error(`[weixin] local codex spawn error: ${String(err)}`);
            resolve({
                ok: false,
                summary: `Failed to start local Codex: ${String(err)}`,
                stdout: trimOutput(stdout),
                stderr: trimOutput(stderr),
                exitCode: null,
                timedOut,
                outputFile,
            });
        });
        child.on("close", (exitCode) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            let message = "";
            try {
                if (fs.existsSync(outputFile)) {
                    message = fs.readFileSync(outputFile, "utf8");
                }
            }
            catch (err) {
                stderr += `\nFailed to read Codex output file: ${String(err)}`;
            }
            const finalText = trimOutput(message || stdout || stderr);
            const ok = !timedOut && exitCode === 0 && Boolean(finalText);
            const summary = timedOut
                ? `Local Codex timed out after ${timeoutMs}ms.`
                : exitCode === 0
                    ? finalText || "Local Codex completed with empty output."
                    : `Local Codex exited with code ${String(exitCode)}.${finalText ? `\n\n${finalText}` : ""}`;
            resolve({
                ok,
                summary,
                stdout: trimOutput(stdout),
                stderr: trimOutput(stderr),
                exitCode,
                timedOut,
                outputFile,
            });
        });
    });
}
//# sourceMappingURL=local-codex.js.map