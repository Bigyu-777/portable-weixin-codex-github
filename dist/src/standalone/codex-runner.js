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
function trimProgressText(text) {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (!normalized) {
        return "";
    }
    return normalized.length > 180
        ? `${normalized.slice(0, 180)}...`
        : normalized;
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
        let sentStarted = false;
        let sentPlan = false;
        let sawCommand = false;
        const startedAt = Date.now();
        const longRunningTimer = setInterval(() => {
            const elapsedMs = Date.now() - startedAt;
            const elapsedMin = Math.max(1, Math.round(elapsedMs / 60_000));
            emitProgress(params, `进度：任务仍在执行，已运行约 ${elapsedMin} 分钟。`);
        }, LONG_RUNNING_PROGRESS_INTERVAL_MS);
        const processJsonLine = (line) => {
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                return;
            }
            if (!sentStarted && parsed.type === "thread.started") {
                sentStarted = true;
                return;
            }
            if (parsed.type === "item.started" && parsed.item?.type === "command_execution") {
                sawCommand = true;
                if (!sentPlan) {
                    emitProgress(params, "进度：Codex 已开始执行任务。");
                    sentPlan = true;
                }
                return;
            }
            if (!sentPlan
                && !sawCommand
                && parsed.type === "item.completed"
                && parsed.item?.type === "agent_message"
                && typeof parsed.item.text === "string") {
                const message = trimProgressText(parsed.item.text);
                if (message) {
                    emitProgress(params, `进度：${message}`);
                    sentPlan = true;
                }
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
