import fs from "node:fs";
import path from "node:path";
import { logger } from "../util/logger.js";
import { getMimeFromFilename } from "../media/mime.js";
import { sendFileMessageWeixin, sendImageMessageWeixin, sendVideoMessageWeixin } from "./send.js";
import { uploadFileAttachmentToWeixin, uploadFileToWeixin, uploadVideoToWeixin } from "../cdn/upload.js";
function detectMimeFromFileSignature(filePath) {
    try {
        const fd = fs.openSync(filePath, "r");
        try {
            const buffer = Buffer.alloc(32);
            const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
            const header = buffer.subarray(0, bytesRead);
            if (header.length >= 3
                && header[0] === 0xff
                && header[1] === 0xd8
                && header[2] === 0xff) {
                return "image/jpeg";
            }
            if (header.length >= 8
                && header[0] === 0x89
                && header[1] === 0x50
                && header[2] === 0x4e
                && header[3] === 0x47
                && header[4] === 0x0d
                && header[5] === 0x0a
                && header[6] === 0x1a
                && header[7] === 0x0a) {
                return "image/png";
            }
            if (header.length >= 6) {
                const sig = header.subarray(0, 6).toString("ascii");
                if (sig === "GIF87a" || sig === "GIF89a") {
                    return "image/gif";
                }
            }
            if (header.length >= 12
                && header.subarray(0, 4).toString("ascii") === "RIFF"
                && header.subarray(8, 12).toString("ascii") === "WEBP") {
                return "image/webp";
            }
            if (header.length >= 2 && header[0] === 0x42 && header[1] === 0x4d) {
                return "image/bmp";
            }
            if (header.length >= 12
                && header.subarray(4, 8).toString("ascii") === "ftyp") {
                const brand = header.subarray(8, 12).toString("ascii");
                if (["mp41", "mp42", "isom", "iso2", "avc1", "M4V ", "qt  "].includes(brand)) {
                    return brand === "qt  " ? "video/quicktime" : "video/mp4";
                }
            }
            return undefined;
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return undefined;
    }
}
function resolveMimeForSend(filePath) {
    const byName = getMimeFromFilename(filePath);
    if (byName !== "application/octet-stream") {
        return byName;
    }
    return detectMimeFromFileSignature(filePath) ?? byName;
}
/**
 * Upload a local file and send it as a weixin message, routing by MIME type:
 *   video/*  → uploadVideoToWeixin        + sendVideoMessageWeixin
 *   image/*  → uploadFileToWeixin         + sendImageMessageWeixin
 *   else     → uploadFileAttachmentToWeixin + sendFileMessageWeixin
 *
 * Used by both the auto-reply deliver path (monitor.ts) and the outbound
 * sendMedia path (channel.ts) so they stay in sync.
 */
export async function sendWeixinMediaFile(params) {
    const { filePath, to, text, opts, cdnBaseUrl } = params;
    const mime = resolveMimeForSend(filePath);
    const uploadOpts = { baseUrl: opts.baseUrl, token: opts.token };
    if (mime.startsWith("video/")) {
        logger.info(`[weixin] sendWeixinMediaFile: uploading video filePath=${filePath} to=${to}`);
        const uploaded = await uploadVideoToWeixin({
            filePath,
            toUserId: to,
            opts: uploadOpts,
            cdnBaseUrl,
        });
        logger.info(`[weixin] sendWeixinMediaFile: video upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
        return sendVideoMessageWeixin({ to, text, uploaded, opts });
    }
    if (mime.startsWith("image/")) {
        logger.info(`[weixin] sendWeixinMediaFile: uploading image filePath=${filePath} to=${to}`);
        const uploaded = await uploadFileToWeixin({
            filePath,
            toUserId: to,
            opts: uploadOpts,
            cdnBaseUrl,
        });
        logger.info(`[weixin] sendWeixinMediaFile: image upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
        return sendImageMessageWeixin({ to, text, uploaded, opts });
    }
    // File attachment: pdf, doc, zip, etc.
    const fileName = path.basename(filePath);
    logger.info(`[weixin] sendWeixinMediaFile: uploading file attachment filePath=${filePath} name=${fileName} to=${to}`);
    const uploaded = await uploadFileAttachmentToWeixin({
        filePath,
        fileName,
        toUserId: to,
        opts: uploadOpts,
        cdnBaseUrl,
    });
    logger.info(`[weixin] sendWeixinMediaFile: file upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
    return sendFileMessageWeixin({ to, text, fileName, uploaded, opts });
}
//# sourceMappingURL=send-media.js.map
