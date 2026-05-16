import fs from "node:fs";
import path from "node:path";
import { formatIdeasForReply, saveIdea } from "../messaging/idea-store.js";
import { clearPeerSession, getPeerSession, resolveSessionRootDir, startNewPeerSession, updatePeerSession, } from "./state.js";
const MODEL_OPTIONS = [
    { key: "default", label: "默认", value: "" },
    { key: "gpt-5.5", label: "GPT-5.5", value: "gpt-5.5" },
    { key: "gpt-5.4", label: "gpt-5.4", value: "gpt-5.4" },
    { key: "gpt-5.4-mini", label: "gpt-5.4-mini", value: "gpt-5.4-mini" },
    { key: "gpt-5.3-codex", label: "gpt-5.3-codex", value: "gpt-5.3-codex" },
    { key: "gpt-5.2", label: "gpt-5.2", value: "gpt-5.2" },
];
const EFFORT_OPTIONS = [
    { key: "default", label: "默认", value: "" },
    { key: "low", label: "low", value: "low" },
    { key: "medium", label: "medium", value: "medium" },
    { key: "high", label: "high", value: "high" },
    { key: "xhigh", label: "xhigh", value: "xhigh" },
];
function normalizeSearchText(value) {
    const text = value?.trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();
    return text || undefined;
}
function extractCandidateNamesFromText(value) {
    const text = String(value ?? "").trim();
    if (!text)
        return [];
    const matches = text.match(/(?:[A-Za-z0-9_\- ]+\.[A-Za-z0-9]{1,10}|media-\d+-[A-Za-z0-9]+\.[A-Za-z0-9]{1,10})/g) ?? [];
    return Array.from(new Set(matches
        .map((item) => item.trim())
        .filter(Boolean)));
}
function collectSessionFiles(sessionDir) {
    const results = [];
    const stack = [sessionDir];
    while (stack.length > 0) {
        const currentDir = stack.pop();
        if (!currentDir || !fs.existsSync(currentDir)) {
            continue;
        }
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (entry.isFile()) {
                const stats = fs.statSync(fullPath);
                results.push({ path: fullPath, name: entry.name, mtimeMs: stats.mtimeMs });
            }
        }
    }
    return results;
}
function resolveFileByFuzzyName(sessionDir, rawName) {
    const needle = normalizeSearchText(rawName);
    if (!needle)
        return undefined;
    const files = collectSessionFiles(sessionDir);
    if (!files.length)
        return undefined;
    const scored = files.map((file) => {
        const basename = file.name.toLowerCase();
        const stem = path.parse(file.name).name.toLowerCase();
        if (basename === needle || stem === needle) {
            return { file, score: 0 };
        }
        if (basename.startsWith(needle) || stem.startsWith(needle)) {
            return { file, score: 1 };
        }
        if (basename.includes(needle) || stem.includes(needle)) {
            return { file, score: 2 };
        }
        if (file.path.toLowerCase().includes(needle)) {
            return { file, score: 3 };
        }
        return null;
    }).filter((item) => item !== null);
    if (!scored.length)
        return undefined;
    scored.sort((a, b) => a.score - b.score || b.file.mtimeMs - a.file.mtimeMs || a.file.path.localeCompare(b.file.path));
    return scored[0].file.path;
}
function resolvePathFromQuotedRef(sessionDir, quotedRef) {
    const candidates = Array.from(new Set([
        ...extractCandidateNamesFromText(quotedRef?.title),
        ...extractCandidateNamesFromText(quotedRef?.message_item?.file_item?.file_name),
        ...extractCandidateNamesFromText(quotedRef?.message_item?.text_item?.text),
    ]));
    for (const candidate of candidates) {
        const resolved = resolveFileByFuzzyName(sessionDir, candidate);
        if (resolved) {
            return resolved;
        }
    }
    return undefined;
}
function resolveSelectedModelOption(selectedModel) {
    const normalized = selectedModel?.trim().toLowerCase();
    if (!normalized) {
        return MODEL_OPTIONS[0];
    }
    return MODEL_OPTIONS.find((item) => item.value.toLowerCase() === normalized) ?? { key: normalized, label: selectedModel, value: selectedModel };
}
function resolveSelectedEffortOption(selectedEffort) {
    const normalized = selectedEffort?.trim().toLowerCase();
    if (!normalized) {
        return EFFORT_OPTIONS[0];
    }
    return EFFORT_OPTIONS.find((item) => item.value.toLowerCase() === normalized) ?? { key: normalized, label: selectedEffort, value: selectedEffort };
}
function formatModelList(selectedModel) {
    const current = resolveSelectedModelOption(selectedModel);
    return [
        `当前模型: ${current.value || "默认（Codex CLI 默认模型）"}`,
        "可选模型：",
        ...MODEL_OPTIONS.map((item, index) => `${index + 1}. ${item.value || "默认"}`),
        "",
        "用法：",
        "/model - 查看当前模型和可选列表",
        "/model 1 - 切换到列表里的第 1 个模型",
        "/model gpt-5.5 - 直接切换到指定模型",
    ].join("\n");
}
function formatEffortList(selectedEffort) {
    const current = resolveSelectedEffortOption(selectedEffort);
    return [
        `当前思考程度: ${current.value || "默认（Codex CLI 默认思考程度）"}`,
        "可选档位：",
        ...EFFORT_OPTIONS.map((item, index) => `${index + 1}. ${item.value || "默认"}`),
        "",
        "用法：",
        "/effort - 查看当前思考程度和可选档位",
        "/effort 1 - 切换到列表里的第 1 个档位",
        "/effort high - 直接切换到指定档位",
    ].join("\n");
}
function resolveModelOptionFromArgs(args) {
    const normalized = args.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    if (/^\d+$/.test(normalized)) {
        const index = Number(normalized) - 1;
        return MODEL_OPTIONS[index];
    }
    return MODEL_OPTIONS.find((item) => item.value.toLowerCase() === normalized || item.key.toLowerCase() === normalized);
}
function resolveEffortOptionFromArgs(args) {
    const normalized = args.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    if (/^\d+$/.test(normalized)) {
        const index = Number(normalized) - 1;
        return EFFORT_OPTIONS[index];
    }
    return EFFORT_OPTIONS.find((item) => item.value.toLowerCase() === normalized || item.key.toLowerCase() === normalized);
}
export async function handleStandaloneCommand(rawText, ctx) {
    const text = rawText.trim();
    if (!text.startsWith("/"))
        return { handled: false };
    const spaceIdx = text.indexOf(" ");
    const command = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();
    switch (command) {
        case "/help":
            return {
                handled: true,
                reply: [
                    "可用命令：",
                    "/help - 查看帮助",
                    "/where - 查看当前保存目录",
                    "/ls - 查看当前会话目录内容",
                    "/model - 查看当前模型和可选模型",
                    "/model <编号|模型名> - 切换当前联系人使用的模型",
                    "/effort - 查看当前思考程度和可选档位",
                    "/effort <编号|档位> - 切换当前联系人使用的思考程度",
                    "/send - 优先发送你引用的附件；如果引用结构缺失，则回退发送最近保存的那个附件",
                    "/send <文件名> - 在当前会话目录里按文件名模糊查找并发送",
                    "/new - 新建一个会话文件夹并开始新对话",
                    "/idea <内容> - 记录灵感",
                    "/ideas - 查看最近灵感",
                    "/reset - 重置当前联系人绑定的 Codex 会话",
                    "/thread - 查看当前 Codex 线程 ID",
                    "",
                    "附件用法：",
                    "直接发文件或图片：只保存到当前会话目录，不会自动处理",
                    "引用某个已发送的文件或图片再发文字：表示让 Codex 处理它",
                ].join("\n"),
            };
        case "/where": {
            const session = getPeerSession(ctx.peerId);
            return {
                handled: true,
                reply: [
                    `根目录: ${resolveSessionRootDir()}`,
                    `当前会话目录: ${session.sessionDir ?? "尚未创建"}`,
                    `当前线程: ${session.threadId ?? "尚未创建"}`,
                ].join("\n"),
            };
        }
        case "/ls": {
            const session = getPeerSession(ctx.peerId);
            if (!session.sessionDir) {
                return {
                    handled: true,
                    reply: "当前还没有会话目录。先发一条普通消息，或者先发 `/new`。",
                };
            }
            if (!fs.existsSync(session.sessionDir)) {
                return {
                    handled: true,
                    reply: `当前会话目录不存在：${session.sessionDir}`,
                };
            }
            const entries = fs.readdirSync(session.sessionDir, { withFileTypes: true })
                .map((entry) => {
                const fullPath = path.join(session.sessionDir, entry.name);
                const stats = fs.statSync(fullPath);
                const kind = entry.isDirectory() ? "[DIR]" : "[FILE]";
                const size = entry.isDirectory() ? "" : ` (${stats.size} bytes)`;
                return `${kind} ${entry.name}${size}`;
            })
                .sort((a, b) => a.localeCompare(b))
                .slice(0, 50);
            return {
                handled: true,
                reply: entries.length > 0
                    ? [
                        `当前目录: ${session.sessionDir}`,
                        ...entries,
                    ].join("\n")
                    : `当前目录为空：${session.sessionDir}`,
            };
        }
        case "/model": {
            const session = getPeerSession(ctx.peerId);
            if (!args) {
                return {
                    handled: true,
                    reply: [
                        formatModelList(session.model),
                        "",
                        `当前思考程度: ${resolveSelectedEffortOption(session.reasoningEffort).value || "默认（Codex CLI 默认思考程度）"}`,
                    ].join("\n"),
                };
            }
            const option = resolveModelOptionFromArgs(args);
            if (!option) {
                return {
                    handled: true,
                    reply: [
                        `无法识别模型：${args}`,
                        "",
                        formatModelList(session.model),
                    ].join("\n"),
                };
            }
            updatePeerSession(ctx.peerId, (previous) => ({
                ...previous,
                peerId: ctx.peerId,
                model: option.value || undefined,
            }));
            return {
                handled: true,
                reply: option.value
                    ? `已切换当前联系人模型为：${option.value}`
                    : "已切换为默认模型（Codex CLI 默认模型）。",
            };
        }
        case "/effort":
        case "/reasoning": {
            const session = getPeerSession(ctx.peerId);
            if (!args) {
                return {
                    handled: true,
                    reply: formatEffortList(session.reasoningEffort),
                };
            }
            const option = resolveEffortOptionFromArgs(args);
            if (!option) {
                return {
                    handled: true,
                    reply: [
                        `无法识别思考程度：${args}`,
                        "",
                        formatEffortList(session.reasoningEffort),
                    ].join("\n"),
                };
            }
            updatePeerSession(ctx.peerId, (previous) => ({
                ...previous,
                peerId: ctx.peerId,
                reasoningEffort: option.value || undefined,
            }));
            return {
                handled: true,
                reply: option.value
                    ? `已切换当前联系人思考程度为：${option.value}`
                    : "已切换为默认思考程度（Codex CLI 默认思考程度）。",
            };
        }
        case "/send": {
            const sessionDir = ctx.sessionDir?.trim() || getPeerSession(ctx.peerId).sessionDir?.trim();
            if (args) {
                if (!sessionDir) {
                    return {
                        handled: true,
                        reply: "当前还没有会话目录，先发一条普通消息或先执行 `/new`。",
                    };
                }
                const resolvedPath = resolveFileByFuzzyName(sessionDir, args);
                if (resolvedPath) {
                    return {
                        handled: true,
                        sendMediaPaths: [resolvedPath],
                    };
                }
                return {
                    handled: true,
                    reply: `在当前会话目录里没找到匹配文件：${args}`,
                };
            }
            if (ctx.quotedMedia?.path) {
                return {
                    handled: true,
                    sendMediaPaths: [ctx.quotedMedia.path],
                };
            }
            if (ctx.quotedRef && sessionDir) {
                const resolvedFromQuotedRef = resolvePathFromQuotedRef(sessionDir, ctx.quotedRef);
                if (resolvedFromQuotedRef) {
                    return {
                        handled: true,
                        sendMediaPaths: [resolvedFromQuotedRef],
                    };
                }
            }
            if (ctx.quotedRef || ctx.quotedMediaItem) {
                return {
                    handled: true,
                    reply: "检测到你引用了消息，但没有匹配到对应文件。可以直接用 `/send 文件名`，或者把原文件重新发一次。",
                };
            }
            if (ctx.latestMedia?.path) {
                return {
                    handled: true,
                    sendMediaPaths: [ctx.latestMedia.path],
                };
            }
            return {
                handled: true,
                reply: "请先引用一条带附件的消息，再发送 `/send`。",
            };
        }
        case "/new": {
            const session = startNewPeerSession(ctx.peerId);
            return {
                handled: true,
                newSession: true,
                reply: [
                    "已开启新会话。",
                    `新目录: ${session.sessionDir}`,
                    "下一条普通消息会从新的 Codex 线程开始。",
                ].join("\n"),
            };
        }
        case "/idea":
            if (!args)
                return { handled: true, reply: "请在 `/idea` 后面写下要记录的想法。" };
            saveIdea({ text: args, source: ctx.peerId });
            return { handled: true, reply: `已记录灵感：${args}` };
        case "/ideas":
            return { handled: true, reply: formatIdeasForReply() };
        case "/reset":
            clearPeerSession(ctx.peerId);
            return {
                handled: true,
                reply: "当前联系人会话已重置。下条普通消息会开启新的 Codex 线程。",
                resetSession: true,
            };
        case "/thread": {
            const session = getPeerSession(ctx.peerId);
            return {
                handled: true,
                reply: session.threadId
                    ? `当前线程: ${session.threadId}`
                    : "当前联系人还没有绑定 Codex 线程。",
            };
        }
        default:
            return { handled: true, reply: `未知命令：${command}\n发送 /help 查看可用命令。` };
    }
}
//# sourceMappingURL=commands.js.map
