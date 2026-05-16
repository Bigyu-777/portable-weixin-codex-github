import fs from "node:fs";
import path from "node:path";
import { downloadMediaFromItem } from "../media/media-download.js";
import { getExtensionFromMime } from "../media/mime.js";
import { tempFileName } from "../util/random.js";
function detectExtensionFromBuffer(buffer) {
    if (buffer.length >= 3
        && buffer[0] === 0xff
        && buffer[1] === 0xd8
        && buffer[2] === 0xff) {
        return ".jpg";
    }
    if (buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47
        && buffer[4] === 0x0d
        && buffer[5] === 0x0a
        && buffer[6] === 0x1a
        && buffer[7] === 0x0a) {
        return ".png";
    }
    if (buffer.length >= 6) {
        const sig = buffer.subarray(0, 6).toString("ascii");
        if (sig === "GIF87a" || sig === "GIF89a") {
            return ".gif";
        }
    }
    if (buffer.length >= 12
        && buffer.subarray(0, 4).toString("ascii") === "RIFF"
        && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return ".webp";
    }
    if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
        return ".bmp";
    }
    return undefined;
}
async function saveBufferToSessionDir(sessionDir, buffer, contentType, _subdir, _maxBytes, originalFilename) {
    const ext = originalFilename
        ? path.extname(originalFilename) || getExtensionFromMime(contentType ?? "application/octet-stream")
        : detectExtensionFromBuffer(buffer) || getExtensionFromMime(contentType ?? "application/octet-stream");
    const filename = originalFilename || tempFileName("media", ext);
    const filePath = path.join(sessionDir, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return { path: filePath };
}
export async function saveIncomingMediaToSession(params) {
    const result = {
        imagePaths: [],
        filePaths: [],
        audioPaths: [],
        videoPaths: [],
        records: [],
    };
    if (!params.itemList?.length)
        return result;
    for (const item of params.itemList) {
        const downloaded = await downloadMediaFromItem(item, {
            cdnBaseUrl: params.cdnBaseUrl,
            saveMedia: (buffer, contentType, subdir, maxBytes, originalFilename) => saveBufferToSessionDir(params.sessionDir, buffer, contentType, subdir, maxBytes, originalFilename),
            log: params.log,
            errLog: params.errLog,
            label: "standalone",
        });
        if (downloaded.decryptedPicPath) {
            result.imagePaths.push(downloaded.decryptedPicPath);
            result.records.push({
                peerId: params.peerId,
                sessionDir: params.sessionDir,
                kind: "image",
                path: downloaded.decryptedPicPath,
                savedAt: Date.now(),
                messageId: params.messageId,
                itemMsgId: item.msg_id,
                itemCreateTimeMs: item.create_time_ms,
            });
        }
        if (downloaded.decryptedFilePath) {
            result.filePaths.push(downloaded.decryptedFilePath);
            result.records.push({
                peerId: params.peerId,
                sessionDir: params.sessionDir,
                kind: "file",
                path: downloaded.decryptedFilePath,
                savedAt: Date.now(),
                messageId: params.messageId,
                itemMsgId: item.msg_id,
                itemCreateTimeMs: item.create_time_ms,
                originalFilename: item.file_item?.file_name,
            });
        }
        if (downloaded.decryptedVoicePath) {
            result.audioPaths.push(downloaded.decryptedVoicePath);
            result.records.push({
                peerId: params.peerId,
                sessionDir: params.sessionDir,
                kind: "audio",
                path: downloaded.decryptedVoicePath,
                savedAt: Date.now(),
                messageId: params.messageId,
                itemMsgId: item.msg_id,
                itemCreateTimeMs: item.create_time_ms,
            });
        }
        if (downloaded.decryptedVideoPath) {
            result.videoPaths.push(downloaded.decryptedVideoPath);
            result.records.push({
                peerId: params.peerId,
                sessionDir: params.sessionDir,
                kind: "video",
                path: downloaded.decryptedVideoPath,
                savedAt: Date.now(),
                messageId: params.messageId,
                itemMsgId: item.msg_id,
                itemCreateTimeMs: item.create_time_ms,
            });
        }
    }
    return result;
}
//# sourceMappingURL=media-store.js.map
