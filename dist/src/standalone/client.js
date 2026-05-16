import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BASE_URL } from "../auth/accounts.js";
import { startWeixinLoginWithQr, waitForWeixinLogin } from "../auth/login-qr.js";
import { getUpdates } from "../api/api.js";
import { MessageItemType } from "../api/types.js";
import { sendWeixinMediaFile } from "../messaging/send-media.js";
import { sendMessageWeixin } from "../messaging/send.js";
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "../storage/sync-buf.js";
import { logger } from "../util/logger.js";
import { handleStandaloneCommand } from "./commands.js";
import { runCodexForPeer } from "./codex-runner.js";
import { describeStandaloneMediaKind, resolveLatestPreferredStandaloneMedia, resolveStandaloneQuotedMedia, saveStandaloneMediaRecords, saveStandaloneOutboundMediaRecord, } from "./media-index.js";
import { saveIncomingMediaToSession } from "./media-store.js";
import { fetchPageSummary } from "./web-page.js";
import { clearStandaloneAuthState, ensurePeerSessionDir, getPeerSession, loadStandaloneAuthState, resolveSessionRootDir, saveStandaloneAuthState, updatePeerSession, } from "./state.js";
import { getStandaloneDisableLocalProxy, getStandaloneHttpProxy } from "./config.js";
function extractTextBody(itemList) {
    if (!itemList?.length)
        return "";
    for (const item of itemList) {
        if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
            return String(item.text_item.text);
        }
        if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
            return String(item.voice_item.text);
        }
    }
    return "";
}
function shouldProcessMessage(message) {
    const from = message.from_user_id?.trim();
    if (!from)
        return false;
    return true;
}
function messageContainsUrl(text) {
    return /https?:\/\/\S+/i.test(text);
}
function extractFirstUrl(text) {
    return text.match(/https?:\/\/\S+/i)?.[0];
}
function hasDirectMedia(itemList) {
    return Boolean(itemList?.some((item) => item.type === MessageItemType.IMAGE ||
        item.type === MessageItemType.FILE ||
        item.type === MessageItemType.VIDEO ||
        item.type === MessageItemType.VOICE));
}
function extractQuotedMediaItem(itemList) {
    return itemList?.find((item) => item.type === MessageItemType.TEXT &&
        item.ref_msg?.message_item &&
        (item.ref_msg.message_item.type === MessageItemType.IMAGE ||
            item.ref_msg.message_item.type === MessageItemType.FILE ||
            item.ref_msg.message_item.type === MessageItemType.VIDEO ||
            item.ref_msg.message_item.type === MessageItemType.VOICE))?.ref_msg?.message_item;
}
function extractQuotedRef(itemList) {
    return itemList?.find((item) => item.type === MessageItemType.TEXT && item.ref_msg)?.ref_msg;
}
function buildSavedMediaReply(sessionDir, paths) {
    if (!paths.length) {
        return [
            "已收到附件，但没有成功保存。",
            "可以稍后重发一次试试。",
        ].join("\n");
    }
    const preview = paths.slice(0, 8).map((mediaPath) => `- ${mediaPath}`);
    const extra = paths.length > 8 ? [`- 还有 ${paths.length - 8} 个文件未展开`] : [];
    return [
        "附件已保存到当前会话目录，不会自动处理。",
        `当前目录: ${sessionDir}`,
        ...preview,
        ...extra,
        "如果你想让我处理其中某个文件或图片，请在微信里引用它，再发文字说明。",
    ].join("\n");
}
function normalizeAbsolutePath(candidate) {
    const value = candidate.trim().replace(/^["'`]+|["'`]+$/g, "");
    if (!value)
        return undefined;
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
        return path.resolve(value);
    }
    if (value.startsWith("/")) {
        return path.resolve(value);
    }
    return undefined;
}
function extractExistingFilesFromText(text, sessionDir) {
    const matches = text.match(/(?:[A-Za-z]:\\[^\s"'`<>|]+|\/[^\s"'`<>|]+)/g) ?? [];
    const seen = new Set();
    const sessionRoot = path.resolve(sessionDir);
    const results = [];
    for (const rawMatch of matches) {
        const filePath = normalizeAbsolutePath(rawMatch);
        if (!filePath || seen.has(filePath))
            continue;
        if (!fs.existsSync(filePath))
            continue;
        if (!fs.statSync(filePath).isFile())
            continue;
        if (filePath !== sessionRoot && !filePath.startsWith(`${sessionRoot}${path.sep}`))
            continue;
        seen.add(filePath);
        results.push(filePath);
    }
    return results;
}
function snapshotSessionFiles(sessionDir) {
    const files = new Map();
    try {
        if (!fs.existsSync(sessionDir)) {
            return files;
        }
        for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
            if (!entry.isFile()) {
                continue;
            }
            const filePath = path.join(sessionDir, entry.name);
            const stats = fs.statSync(filePath);
            files.set(filePath, {
                size: stats.size,
                mtimeMs: stats.mtimeMs,
            });
        }
    }
    catch {
        // best-effort snapshot
    }
    return files;
}
function detectChangedSessionFiles(sessionDir, beforeSnapshot) {
    const changed = [];
    try {
        if (!fs.existsSync(sessionDir)) {
            return changed;
        }
        for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
            if (!entry.isFile()) {
                continue;
            }
            const filePath = path.join(sessionDir, entry.name);
            const stats = fs.statSync(filePath);
            const previous = beforeSnapshot.get(filePath);
            if (!previous
                || previous.size !== stats.size
                || previous.mtimeMs !== stats.mtimeMs) {
                changed.push(filePath);
            }
        }
    }
    catch {
        // best-effort diff
    }
    return changed.sort((a, b) => {
        const aStat = fs.statSync(a);
        const bStat = fs.statSync(b);
        return aStat.mtimeMs - bStat.mtimeMs;
    });
}
function buildMediaCaption(reply, filePath) {
    const compact = reply.trim();
    const base = `已处理完成，结果文件：${path.basename(filePath)}`;
    if (!compact)
        return base;
    if (compact.includes(filePath))
        return base;
    return `${base}\n\n${compact}`.slice(0, 1000);
}
async function sendGeneratedFiles(to, reply, filePaths, contextToken) {
    const auth = loadStandaloneAuthState();
    if (!auth || !filePaths.length)
        return false;
    for (const filePath of filePaths) {
        await sendWeixinMediaFile({
            filePath,
            to,
            text: buildMediaCaption(reply, filePath),
            opts: {
                baseUrl: auth.baseUrl,
                token: auth.token,
                contextToken,
            },
            cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        });
        saveStandaloneOutboundMediaRecord(to, {
            peerId: to,
            sessionDir: path.dirname(filePath),
            kind: getFileRecordKind(filePath),
            path: filePath,
            savedAt: Date.now(),
            originalFilename: path.basename(filePath),
        });
    }
    return true;
}
async function sendLocalFiles(to, filePaths, contextToken, text = "") {
    const auth = loadStandaloneAuthState();
    if (!auth || !filePaths.length) {
        return false;
    }
    for (const filePath of filePaths) {
        await sendWeixinMediaFile({
            filePath,
            to,
            text,
            opts: {
                baseUrl: auth.baseUrl,
                token: auth.token,
                contextToken,
            },
            cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        });
        saveStandaloneOutboundMediaRecord(to, {
            peerId: to,
            sessionDir: path.dirname(filePath),
            kind: getFileRecordKind(filePath),
            path: filePath,
            savedAt: Date.now(),
            originalFilename: path.basename(filePath),
        });
    }
    return true;
}
function getFileRecordKind(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) {
        return "image";
    }
    if ([".mp4", ".mov", ".webm", ".mkv", ".avi"].includes(ext)) {
        return "video";
    }
    if ([".mp3", ".ogg", ".wav", ".silk"].includes(ext)) {
        return "audio";
    }
    return "file";
}
async function buildCodexPrompt(text) {
    const url = extractFirstUrl(text);
    if (!url) {
        return { prompt: text, enableSearch: false };
    }
    const pageSummary = await fetchPageSummary(url);
    return {
        enableSearch: false,
        prompt: [
            "下面是用户发来的链接和我预先抓取到的页面内容。",
            "请基于这些内容，用中文简洁说明“这个是做了些什么”。",
            "如果内容不完整，请明确说明你是基于页面摘录做的总结。",
            "",
            `用户原始消息:\n${text}`,
            "",
            pageSummary,
        ].join("\n"),
    };
}
async function replyText(to, text, contextToken) {
    const auth = loadStandaloneAuthState();
    if (!auth)
        throw new Error("尚未登录微信。");
    await sendMessageWeixin({
        to,
        text,
        opts: {
            baseUrl: auth.baseUrl,
            token: auth.token,
            contextToken,
        },
    });
}
function createProgressReporter(to, contextToken, initialSessionContextToken) {
    let lastSentAt = 0;
    const sentMessages = new Set();
    return async (message) => {
        const text = String(message ?? "").trim();
        if (!text || sentMessages.has(text)) {
            return;
        }
        const now = Date.now();
        if (now - lastSentAt < 3000) {
            return;
        }
        sentMessages.add(text);
        lastSentAt = now;
        await replyText(to, text, contextToken || initialSessionContextToken);
    };
}
async function handleIncomingMessage(message) {
    const auth = loadStandaloneAuthState();
    if (!auth)
        throw new Error("尚未登录微信。");
    const peerId = message.from_user_id ?? "";
    const text = extractTextBody(message.item_list).trim();
    const contextToken = message.context_token;
    console.log(`[inbound] from=${peerId} text=${JSON.stringify(text.slice(0, 120))} type=${String(message.message_type ?? "unknown")}`);
    updatePeerSession(peerId, (previous) => ({
        ...previous,
        peerId,
        contextToken: contextToken || previous.contextToken,
        lastInboundAt: Date.now(),
    }));
    const session = getPeerSession(peerId);
    const workdir = ensurePeerSessionDir(peerId);
    const media = await saveIncomingMediaToSession({
        peerId,
        messageId: message.message_id,
        itemList: message.item_list,
        sessionDir: workdir,
        cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        log: (msg) => console.log(`[media] ${msg}`),
        errLog: (msg) => console.error(`[media-error] ${msg}`),
    });
    saveStandaloneMediaRecords(peerId, media.records);
    const directMediaPaths = [
        ...media.imagePaths,
        ...media.filePaths,
        ...media.audioPaths,
        ...media.videoPaths,
    ];
    const directMediaOnly = directMediaPaths.length > 0 && !text;
    if (directMediaOnly || (hasDirectMedia(message.item_list) && !text)) {
        console.log(`[reply] saved media only -> ${peerId}`);
        await replyText(peerId, buildSavedMediaReply(workdir, directMediaPaths), contextToken || session.contextToken);
        updatePeerSession(peerId, (previous) => ({
            ...previous,
            lastOutboundAt: Date.now(),
        }));
        return;
    }
    const quotedMediaItem = extractQuotedMediaItem(message.item_list);
    const quotedRef = extractQuotedRef(message.item_list);
    const quotedMedia = quotedMediaItem
        ? resolveStandaloneQuotedMedia(peerId, quotedMediaItem)
        : undefined;
    if (text.trim().toLowerCase().startsWith("/send")) {
        console.log(`[send-debug] peer=${peerId} text=${JSON.stringify(text)} quotedRef=${JSON.stringify(quotedRef ?? null)} quotedItem=${JSON.stringify(quotedMediaItem ?? null)} resolvedQuotedMedia=${JSON.stringify(quotedMedia ?? null)}`);
    }
    const fallbackQuotedMedia = (!quotedRef && !quotedMedia && text.trim().toLowerCase() === "/send")
        ? resolveLatestPreferredStandaloneMedia(peerId)
        : undefined;
    const commandResult = await handleStandaloneCommand(text, {
        peerId,
        sessionDir: workdir,
        quotedRef,
        quotedMedia: quotedMedia || fallbackQuotedMedia,
        latestMedia: fallbackQuotedMedia,
        quotedMediaItem,
    });
    if (commandResult.handled) {
        let sentMedia = false;
        if (commandResult.sendMediaPaths?.length) {
            console.log(`[reply] command send media -> ${peerId} files=${commandResult.sendMediaPaths.length} paths=${JSON.stringify(commandResult.sendMediaPaths)}`);
            sentMedia = await sendLocalFiles(peerId, commandResult.sendMediaPaths, contextToken || session.contextToken, commandResult.sendMediaText || "");
        }
        if (commandResult.reply) {
            console.log(`[reply] command -> ${peerId}`);
            await replyText(peerId, commandResult.reply, contextToken || session.contextToken);
        }
        if (sentMedia || commandResult.reply) {
            updatePeerSession(peerId, (previous) => ({
                ...previous,
                lastOutboundAt: Date.now(),
            }));
        }
        return;
    }
    const promptParts = [];
    let imagePaths = [...media.imagePaths];
    if (quotedMedia) {
        if (quotedMedia.kind === "image") {
            imagePaths = [...imagePaths, quotedMedia.path];
            promptParts.push([
                "用户这次引用了一张之前保存的图片。",
                `引用图片路径: ${quotedMedia.path}`,
                `当前要求: ${text || "请处理这张图片"}`,
                "如果你生成了新的图片或文件，请把最终生成文件保存到当前会话目录，并在回复里写出完整绝对路径。",
            ].join("\n"));
        }
        else {
            promptParts.push([
                `用户这次引用了一个之前保存的${describeStandaloneMediaKind(quotedMedia.kind)}。`,
                `引用文件路径: ${quotedMedia.path}`,
                `当前要求: ${text || "请处理这个文件"}`,
                "如果你生成了新的图片或文件，请把最终生成文件保存到当前会话目录，并在回复里写出完整绝对路径。",
            ].join("\n"));
        }
    }
    else if (quotedMediaItem && text) {
        promptParts.push([
            "用户引用了一个附件，但本地没有匹配到保存记录。",
            "请先根据当前文字理解意图；如果需要具体文件内容，也请提醒用户重新发送或重新引用。",
            `当前要求: ${text}`,
        ].join("\n"));
    }
    else {
        promptParts.push(text);
    }
    const rawPrompt = promptParts.filter(Boolean).join("\n\n").trim();
    if (!rawPrompt) {
        return;
    }
    const sessionFilesBeforeCodex = snapshotSessionFiles(workdir);
    const reportProgress = createProgressReporter(peerId, contextToken, session.contextToken);
    const codexInput = await buildCodexPrompt(rawPrompt);
    const codexResult = await runCodexForPeer({
        prompt: codexInput.prompt,
        threadId: session.threadId,
        model: session.model,
        reasoningEffort: session.reasoningEffort,
        workdir,
        enableSearch: codexInput.enableSearch,
        imagePaths,
        onProgress: reportProgress,
    });
    if (!codexResult.ok) {
        console.error(`[codex-error] peer=${peerId} thread=${session.threadId ?? "none"} text=${JSON.stringify(codexResult.text)} stderr=${JSON.stringify(codexResult.stderr)}`);
    }
    const reply = codexResult.ok
        ? codexResult.text
        : `${codexResult.text}${codexResult.stderr ? `\n\nstderr:\n${codexResult.stderr}` : ""}`;
    const generatedFiles = codexResult.ok
        ? Array.from(new Set([
            ...extractExistingFilesFromText(reply, workdir),
            ...detectChangedSessionFiles(workdir, sessionFilesBeforeCodex),
        ]))
        : [];
    console.log(`[reply] codex -> ${peerId} thread=${codexResult.threadId ?? "new/unknown"} files=${generatedFiles.length}`);
    const sentMedia = generatedFiles.length > 0
        ? await sendGeneratedFiles(peerId, reply, generatedFiles, contextToken || session.contextToken)
        : false;
    if (!sentMedia) {
        await replyText(peerId, reply, contextToken || session.contextToken);
    }
    updatePeerSession(peerId, (previous) => ({
        ...previous,
        threadId: codexResult.threadId || previous.threadId,
        contextToken: contextToken || previous.contextToken,
        lastOutboundAt: Date.now(),
    }));
}
export async function loginStandaloneWeixin() {
    const start = await startWeixinLoginWithQr({
        apiBaseUrl: DEFAULT_BASE_URL,
    });
    if (!start.qrcodeUrl) {
        throw new Error(start.message);
    }
    console.log(start.message);
    console.log(start.qrcodeUrl);
    const qrterm = await import("qrcode-terminal");
    qrterm.default.generate(start.qrcodeUrl, { small: true });
    const done = await waitForWeixinLogin({
        sessionKey: start.sessionKey,
        apiBaseUrl: DEFAULT_BASE_URL,
        verbose: true,
    });
    if (!done.connected || !done.botToken || !done.accountId) {
        throw new Error(done.message);
    }
    saveStandaloneAuthState({
        accountId: done.accountId,
        token: done.botToken,
        userId: done.userId,
        baseUrl: done.baseUrl?.trim() || DEFAULT_BASE_URL,
        savedAt: new Date().toISOString(),
    });
    console.log(done.message);
}
export async function logoutStandaloneWeixin() {
    clearStandaloneAuthState();
    console.log("已清除本地登录状态。");
}
export async function runStandaloneWeixinBridge() {
    const auth = loadStandaloneAuthState();
    if (!auth) {
        throw new Error("未检测到登录状态，请先运行 `npm run standalone:login`。");
    }
    const syncFilePath = getSyncBufFilePath(auth.accountId);
    let getUpdatesBuf = loadGetUpdatesBuf(syncFilePath) ?? "";
    const effectiveProxy = getStandaloneHttpProxy()
        || process.env.WEIXIN_HTTP_PROXY?.trim()
        || process.env.HTTPS_PROXY?.trim()
        || process.env.HTTP_PROXY?.trim()
        || (process.env.WEIXIN_DISABLE_LOCAL_PROXY === "1" || getStandaloneDisableLocalProxy()
            ? ""
            : "http://127.0.0.1:7890");
    console.log(`微信桥接已启动，账号 ${auth.accountId}`);
    console.log(`微信接口: ${auth.baseUrl}`);
    console.log(`代理: ${effectiveProxy || "disabled"}`);
    console.log(`会话根目录: ${resolveSessionRootDir()}`);
    logger.info(`[standalone] bridge started accountId=${auth.accountId}`);
    while (true) {
        try {
            console.log("[poll] waiting for updates...");
            const resp = await getUpdates({
                baseUrl: auth.baseUrl,
                token: auth.token,
                get_updates_buf: getUpdatesBuf,
                timeoutMs: 35_000,
            });
            console.log(`[poll] ret=${String(resp.ret ?? "")} msgs=${resp.msgs?.length ?? 0} cursorLen=${resp.get_updates_buf?.length ?? 0}`);
            if (resp.get_updates_buf) {
                getUpdatesBuf = resp.get_updates_buf;
                saveGetUpdatesBuf(syncFilePath, getUpdatesBuf);
            }
            for (const message of resp.msgs ?? []) {
                console.log(`[poll] raw message from=${message.from_user_id ?? ""} type=${String(message.message_type ?? "unknown")} state=${String(message.message_state ?? "unknown")}`);
                if (!shouldProcessMessage(message))
                    continue;
                try {
                    await handleIncomingMessage(message);
                }
                catch (err) {
                    console.error(`[error] inbound handler failed: ${String(err)}`);
                    const to = message.from_user_id ?? "";
                    const contextToken = message.context_token;
                    if (to) {
                        await replyText(to, `处理消息失败：${String(err)}`, contextToken);
                    }
                }
            }
        }
        catch (err) {
            console.error(`[poll-error] ${String(err)}`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
}
//# sourceMappingURL=client.js.map
