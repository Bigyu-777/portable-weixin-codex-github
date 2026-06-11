import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStandaloneCodexCommand, getStandaloneCodexTimeoutMs, getStandaloneCodexWorkdir, } from "./config.js";
function resolveCodexCommand() {
    const configured = process.env.WEIXIN_CODEX_COMMAND?.trim() || getStandaloneCodexCommand();
    if (configured)
        return configured;
    if (process.platform === "win32") {
        const candidates = [
            path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "bin", "codex.exe"),
            path.join(process.env.USERPROFILE ?? "", ".codex", ".sandbox-bin", "codex.exe"),
            "codex.exe",
        ];
        for (const candidate of candidates) {
            if (candidate === "codex.exe" || fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return "codex.exe";
    }
    return "codex";
}
function resolveCodexWorkdir(override) {
    if (override?.trim())
        return path.resolve(override);
    const configured = process.env.WEIXIN_CODEX_WORKDIR?.trim() || getStandaloneCodexWorkdir();
    return configured
        ? path.resolve(configured)
        : process.cwd();
}
function resolveCodexTimeoutMs() {
    const configured = process.env.WEIXIN_CODEX_TIMEOUT_MS ?? getStandaloneCodexTimeoutMs();
    if (configured == null || configured === "") {
        return 180_000;
    }
    const raw = Number(configured);
    if (!Number.isFinite(raw)) {
        return 180_000;
    }
    if (raw <= 0) {
        return undefined;
    }
    return raw;
}
function parseThreadId(stdout) {
    for (const line of stdout.split(/\r?\n/)) {
        try {
            const parsed = JSON.parse(line);
            if (parsed.type === "thread.started" && parsed.thread_id) {
                return parsed.thread_id;
            }
            if (parsed.type === "session.resumed" && parsed.thread_id) {
                return parsed.thread_id;
            }
        }
        catch {
            // ignore non-json lines
        }
    }
    return undefined;
}
function trimReply(text) {
    const normalized = text.trim();
    if (!normalized)
        return "";
    return normalized.length > 6000
        ? `${normalized.slice(0, 6000)}\n\n[truncated ${normalized.length - 6000} chars]`
        : normalized;
}
const RESUME_ATTEMPT_TIMEOUT_MS = 30_000;
const LONG_RUNNING_PROGRESS_INTERVAL_MS = 180_000;
const PROGRESS_THROTTLE_MS = 4_000;
function trimProgressText(text) {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (!normalized) {
        return "";
    }
    return normalized.length > 180
        ? `${normalized.slice(0, 180)}...`
        : normalized;
}
function trimCommandText(text) {
    const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
    if (!normalized) {
        return "";
    }
    return normalized.length > 220
        ? `${normalized.slice(0, 220)}...`
        : normalized;
}
function trimCommandOutput(text) {
    const normalized = String(text ?? "").trim();
    if (!normalized) {
        return "";
    }
    const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const compact = lines.slice(0, 4).join("\n");
    return compact.length > 500
        ? `${compact.slice(0, 500)}...`
        : compact;
}
function progressCommandLabel(command) {
    const text = trimCommandText(command);
    if (!text) {
        return "我在终端跑一个命令。";
    }
    return `我在终端跑：\n${text}`;
}
function progressCommandCompleted(item) {
    const exitCode = item?.exit_code;
    const output = trimCommandOutput(item?.aggregated_output);
    if (exitCode === 0) {
        return output
            ? `跑完了，输出前几行：\n${output}`
            : "这条命令跑完了。";
    }
    return [
        `这条命令失败了，退出码 ${String(exitCode ?? "unknown")}。`,
        output ? `输出前几行：\n${output}` : "",
    ].filter(Boolean).join("\n");
}
function normalizeProgressMessage(message) {
    return String(message ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .replace(/已运行约 \d+ 分钟/g, "已运行约 N 分钟")
        .toLowerCase();
}
function emitProgress(params, message) {
    if (!message || typeof params.onProgress !== "function") {
        return;
    }
    Promise.resolve(params.onProgress(message)).catch(() => {
        // best-effort progress reporting
    });
}
function buildFailureText(code, signal, timedOut) {
    if (timedOut) {
        return "Codex 执行超时。";
    }
    if (signal) {
        return `Codex 执行被信号中断：${signal}。`;
    }
    if (code == null) {
        return "Codex 执行失败，进程异常结束。";
    }
    return `Codex 执行失败，退出码 ${String(code)}。`;
}
function buildCodexArgs(params, outputFile) {
    const commonExecArgs = [
        ...(params.enableSearch ? ["--search"] : []),
        ...(params.model?.trim() ? ["-m", params.model.trim()] : []),
        ...(params.reasoningEffort?.trim() ? ["-c", `model_reasoning_effort="${params.reasoningEffort.trim()}"`] : []),
        ...((params.imagePaths ?? []).flatMap((imagePath) => ["-i", imagePath])),
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--output-last-message",
        outputFile,
        "--json",
    ];
    if (params.threadId) {
        return [
            "exec",
            "resume",
            ...commonExecArgs,
            params.threadId,
            params.prompt,
        ];
    }
    return [
        "exec",
        ...commonExecArgs,
        params.prompt,
    ];
}
async function runCodexOnce(params) {
    const command = resolveCodexCommand();
    const workdir = resolveCodexWorkdir(params.workdir);
    const timeoutMs = params.timeoutMsOverride && params.timeoutMsOverride > 0
        ? params.timeoutMsOverride
        : resolveCodexTimeoutMs();
    const outputFile = path.join(os.tmpdir(), `weixin-codex-reply-${Date.now()}.txt`);
    const args = buildCodexArgs(params, outputFile);
    return await new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: workdir,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let finished = false;
        let timedOut = false;
        let stdoutBuffer = "";
        let lastProgressSentAt = 0;
        const sentProgressMessages = new Set();
        let lastCommandText = "";
        const startedAt = Date.now();
        const emitDetailedProgress = (message, options = {}) => {
            const text = String(message ?? "").trim();
            const normalized = normalizeProgressMessage(text);
            if (!text || sentProgressMessages.has(normalized)) {
                return;
            }
            const now = Date.now();
            if (!options.force && now - lastProgressSentAt < PROGRESS_THROTTLE_MS) {
                return;
            }
            sentProgressMessages.add(normalized);
            lastProgressSentAt = now;
            emitProgress(params, text);
        };
        const longRunningTimer = setInterval(() => {
            const elapsedMs = Date.now() - startedAt;
            const elapsedMin = Math.max(1, Math.round(elapsedMs / 60_000));
            emitDetailedProgress(`还在处理，已经约 ${elapsedMin} 分钟；我会继续等结果。`, { force: true });
        }, LONG_RUNNING_PROGRESS_INTERVAL_MS);
        const processJsonLine = (line) => {
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                return;
            }
            if (parsed.type === "session.resumed") {
                emitDetailedProgress("我接着上次的线程继续处理。", { force: true });
                return;
            }
            if (parsed.type === "item.started" && parsed.item?.type === "command_execution") {
                lastCommandText = trimCommandText(parsed.item.command);
                emitDetailedProgress(progressCommandLabel(parsed.item.command), { force: true });
                return;
            }
            if (parsed.type === "item.completed" && parsed.item?.type === "command_execution") {
                const commandText = trimCommandText(parsed.item.command);
                const output = trimCommandOutput(parsed.item.aggregated_output);
                const exitCode = parsed.item.exit_code;
                const shouldReportCompletion = exitCode !== 0 || Boolean(output) || commandText !== lastCommandText;
                if (shouldReportCompletion) {
                    emitDetailedProgress(progressCommandCompleted(parsed.item), { force: true });
                }
                return;
            }
        };
        const timer = timeoutMs != null
            ? setTimeout(() => {
                timedOut = true;
                child.kill();
            }, timeoutMs)
            : undefined;
        child.stdout.on("data", (chunk) => {
            const text = String(chunk);
            stdout += text;
            stdoutBuffer += text;
            let newlineIndex = stdoutBuffer.indexOf("\n");
            while (newlineIndex !== -1) {
                const line = stdoutBuffer.slice(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                if (line) {
                    processJsonLine(line);
                }
                newlineIndex = stdoutBuffer.indexOf("\n");
            }
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("error", (err) => {
            if (finished)
                return;
            finished = true;
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            clearInterval(longRunningTimer);
            resolve({
                ok: false,
                text: `启动 Codex 失败: ${String(err)}`,
                stderr: trimReply(stderr),
            });
        });
        child.on("close", (code) => {
            if (finished)
                return;
            finished = true;
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            clearInterval(longRunningTimer);
            let reply = "";
            try {
                if (fs.existsSync(outputFile)) {
                    reply = fs.readFileSync(outputFile, "utf8");
                }
            }
            catch (err) {
                stderr += `\n读取 Codex 输出失败: ${String(err)}`;
            }
            const threadId = parseThreadId(stdout) ?? params.threadId;
            const text = trimReply(reply);
            resolve({
                ok: code === 0 && Boolean(text),
                text: text || (code === 0 ? "Codex 没有返回文本。" : buildFailureText(code, null, timedOut)),
                threadId,
                stderr: trimReply(stderr),
                timedOut,
            });
        });
        child.on("exit", (_code, signal) => {
            if (!signal) {
                return;
            }
            stderr += `\nprocess signal: ${signal}`;
        });
    });
}
export async function runCodexForPeer(params) {
    const prompt = params.prompt.trim();
    if (!prompt) {
        return { ok: false, text: "消息为空。", stderr: "" };
    }
    const fullTimeoutMs = resolveCodexTimeoutMs();
    const primary = await runCodexOnce({
        ...params,
        prompt,
        timeoutMsOverride: params.threadId
            ? Math.min(fullTimeoutMs, RESUME_ATTEMPT_TIMEOUT_MS)
            : fullTimeoutMs,
    });
    if (primary.ok) {
        return primary;
    }
    const shouldRetryFresh = Boolean(params.threadId)
        && (!primary.threadId || primary.threadId === params.threadId)
        && (primary.timedOut
            || primary.text.includes("进程异常结束")
            || primary.text.includes("被信号中断")
            || primary.text.includes("退出码 null"));
    if (!shouldRetryFresh) {
        return primary;
    }
    emitProgress(params, "进度：恢复上次会话较慢，已改为新会话继续处理。");
    const retry = await runCodexOnce({
        ...params,
        prompt,
        threadId: undefined,
        timeoutMsOverride: fullTimeoutMs,
    });
    if (retry.ok) {
        return retry;
    }
    return {
        ...primary,
        stderr: trimReply([
            primary.stderr,
            "resume failed; retried with a fresh thread but still failed.",
            retry.stderr,
        ].filter(Boolean).join("\n")),
    };
}
//# sourceMappingURL=codex-runner.js.map
