import fs from "node:fs";
import path from "node:path";
import { MessageItemType } from "../api/types.js";
import { resolveStateDir } from "../storage/state-dir.js";
function resolveMediaIndexFilePath() {
    return path.join(resolveStateDir(), "weixin-codex-direct", "media-index.json");
}
function readMediaIndex() {
    try {
        const filePath = resolveMediaIndexFilePath();
        if (!fs.existsSync(filePath))
            return {};
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch {
        return {};
    }
}
function writeMediaIndex(index) {
    const filePath = resolveMediaIndexFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(index, null, 2), "utf8");
}
function normalizeName(name) {
    const value = name?.trim().toLowerCase();
    return value || undefined;
}
function isGenericMediaBin(record) {
    const name = normalizeName(record.originalFilename || path.basename(record.path || ""));
    return Boolean(name?.startsWith("media-") && name.endsWith(".bin"));
}
function mediaKindFromItem(item) {
    switch (item?.type) {
        case MessageItemType.IMAGE:
            return "image";
        case MessageItemType.FILE:
            return "file";
        case MessageItemType.VIDEO:
            return "video";
        case MessageItemType.VOICE:
            return "audio";
        default:
            return undefined;
    }
}
function quotedFileNameFromItem(item) {
    return item?.file_item?.file_name?.trim() || undefined;
}
function chooseClosestSavedAt(records, targetMs, maxDeltaMs = 15000) {
    let best = undefined;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const record of records) {
        if (!record.savedAt)
            continue;
        const delta = Math.abs(record.savedAt - targetMs);
        if (delta > maxDeltaMs)
            continue;
        if (delta < bestDelta) {
            best = record;
            bestDelta = delta;
        }
    }
    return best;
}
export function saveStandaloneMediaRecords(peerId, records) {
    if (!records.length)
        return;
    const index = readMediaIndex();
    const next = [...(index[peerId] ?? []), ...records]
        .filter((record) => record.path?.trim())
        .sort((a, b) => a.savedAt - b.savedAt)
        .slice(-200);
    index[peerId] = next;
    writeMediaIndex(index);
}
export function saveStandaloneOutboundMediaRecord(peerId, record) {
    if (!record?.path?.trim()) {
        return;
    }
    const index = readMediaIndex();
    const next = [...(index[peerId] ?? []), record]
        .filter((item) => item.path?.trim())
        .sort((a, b) => a.savedAt - b.savedAt)
        .slice(-200);
    index[peerId] = next;
    writeMediaIndex(index);
}
export function resolveStandaloneQuotedMedia(peerId, quotedItem) {
    const kind = mediaKindFromItem(quotedItem);
    if (!kind)
        return undefined;
    const candidates = (readMediaIndex()[peerId] ?? [])
        .filter((record) => record.kind === kind && record.path && fs.existsSync(record.path))
        .sort((a, b) => a.savedAt - b.savedAt);
    if (!candidates.length)
        return undefined;
    const quotedItemMsgId = quotedItem?.msg_id?.trim();
    if (quotedItemMsgId) {
        const byItemMsgId = [...candidates].reverse()
            .find((record) => record.itemMsgId === quotedItemMsgId);
        if (byItemMsgId)
            return byItemMsgId;
    }
    const quotedCreateTimeMs = quotedItem?.create_time_ms;
    if (quotedCreateTimeMs) {
        const byCreateTime = [...candidates].reverse()
            .find((record) => record.itemCreateTimeMs === quotedCreateTimeMs);
        if (byCreateTime)
            return byCreateTime;
        const bySavedAt = chooseClosestSavedAt(candidates, quotedCreateTimeMs);
        if (bySavedAt)
            return bySavedAt;
    }
    const quotedFileName = normalizeName(quotedFileNameFromItem(quotedItem));
    if (quotedFileName) {
        const byName = [...candidates].reverse()
            .find((record) => {
            const originalName = normalizeName(record.originalFilename);
            const basename = normalizeName(path.basename(record.path));
            return originalName === quotedFileName || basename === quotedFileName;
        });
        if (byName)
            return byName;
    }
    return undefined;
}
export function resolveLatestStandaloneMedia(peerId) {
    const candidates = (readMediaIndex()[peerId] ?? [])
        .filter((record) => record.path && fs.existsSync(record.path))
        .sort((a, b) => a.savedAt - b.savedAt);
    return candidates[candidates.length - 1];
}
export function resolveLatestPreferredStandaloneMedia(peerId) {
    const candidates = (readMediaIndex()[peerId] ?? [])
        .filter((record) => record.path && fs.existsSync(record.path))
        .sort((a, b) => a.savedAt - b.savedAt);
    if (!candidates.length) {
        return undefined;
    }
    const preferred = [...candidates].reverse().find((record) => !isGenericMediaBin(record));
    return preferred ?? candidates[candidates.length - 1];
}
export function describeStandaloneMediaKind(kind) {
    switch (kind) {
        case "image":
            return "图片";
        case "file":
            return "文件";
        case "audio":
            return "音频";
        case "video":
            return "视频";
    }
}
//# sourceMappingURL=media-index.js.map
