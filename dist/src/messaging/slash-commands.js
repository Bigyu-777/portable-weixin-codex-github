import { logger } from "../util/logger.js";
import { toggleDebugMode } from "./debug-mode.js";
import { formatIdeasForReply, saveIdea } from "./idea-store.js";
import { runLocalCodex } from "./local-codex.js";
import { sendMessageWeixin } from "./send.js";
/** 发送回复消息 */
async function sendReply(ctx, text) {
    const opts = {
        baseUrl: ctx.baseUrl,
        token: ctx.token,
        contextToken: ctx.contextToken,
    };
    await sendMessageWeixin({ to: ctx.to, text, opts });
}
/** 处理 /echo 指令 */
async function handleEcho(ctx, args, receivedAt, eventTimestamp) {
    const message = args.trim();
    if (message) {
        await sendReply(ctx, message);
    }
    const eventTs = eventTimestamp ?? 0;
    const platformDelay = eventTs > 0 ? `${receivedAt - eventTs}ms` : "N/A";
    const timing = [
        "⏱ 通道耗时",
        `├ 事件时间: ${eventTs > 0 ? new Date(eventTs).toISOString() : "N/A"}`,
        `├ 平台→插件: ${platformDelay}`,
        `└ 插件处理: ${Date.now() - receivedAt}ms`,
    ].join("\n");
    await sendReply(ctx, timing);
}
function buildHelpText() {
    return [
        "可用命令：",
        "/help - 查看这份帮助",
        "/echo <内容> - 直接回显并显示通道耗时",
        "/toggle-debug - 开关调试模式",
        "/codex <问题> - 直连这台电脑上的 Codex CLI",
        "/idea <灵感> - 记录一条新想法",
        "/ideas - 查看最近记录的想法",
    ].join("\n");
}
/**
 * 尝试处理斜杠指令
 *
 * @returns handled=true 表示该消息已作为指令处理，不需要继续走 AI 管道
 */
export async function handleSlashCommand(content, ctx, receivedAt, eventTimestamp) {
    const trimmed = content.trim();
    if (!trimmed.startsWith("/")) {
        return { handled: false };
    }
    const spaceIdx = trimmed.indexOf(" ");
    const command = spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
    const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
    logger.info(`[weixin] Slash command: ${command}, args: ${args.slice(0, 50)}`);
    try {
        switch (command) {
            case "/help":
                await sendReply(ctx, buildHelpText());
                return { handled: true };
            case "/echo":
                await handleEcho(ctx, args, receivedAt, eventTimestamp);
                return { handled: true };
            case "/toggle-debug": {
                const enabled = toggleDebugMode(ctx.accountId);
                await sendReply(ctx, enabled ? "Debug 模式已开启" : "Debug 模式已关闭");
                return { handled: true };
            }
            case "/codex": {
                const prompt = args.trim();
                if (!prompt) {
                    await sendReply(ctx, "请在 `/codex` 后面带上问题或任务。");
                    return { handled: true };
                }
                await sendReply(ctx, "本机 Codex 正在处理，稍等一下。");
                const result = await runLocalCodex({ prompt });
                await sendReply(ctx, result.summary);
                return { handled: true };
            }
            case "/idea": {
                const text = args.trim();
                if (!text) {
                    await sendReply(ctx, "请在 `/idea` 后面写下你要记录的想法。");
                    return { handled: true };
                }
                const record = saveIdea({ text, source: ctx.to });
                await sendReply(ctx, `已记录灵感。\n时间: ${record.createdAt}\n内容: ${record.text}`);
                return { handled: true };
            }
            case "/ideas":
                await sendReply(ctx, formatIdeasForReply());
                return { handled: true };
            default:
                return { handled: false };
        }
    }
    catch (err) {
        logger.error(`[weixin] Slash command error: ${String(err)}`);
        try {
            await sendReply(ctx, `指令执行失败: ${String(err).slice(0, 200)}`);
        }
        catch {
            // 发送错误消息也失败了，只能记日志
        }
        return { handled: true };
    }
}
//# sourceMappingURL=slash-commands.js.map