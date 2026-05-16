import { logger } from "../util/logger.js";
import { getStandaloneDisableLocalProxy, getStandaloneHttpProxy } from "./config.js";
function htmlDecode(text) {
    return text
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}
function stripTags(text) {
    return text.replace(/<[^>]+>/g, " ");
}
function cleanWhitespace(text) {
    return text
        .replace(/\r/g, "")
        .replace(/\t/g, " ")
        .replace(/[ \u00A0]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function extractMetaContent(html, key) {
    const patterns = [
        new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, "i"),
        new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1])
            return htmlDecode(match[1]);
    }
    return undefined;
}
function extractWechatArticleText(html) {
    const title = html.match(/var\s+msg_title\s*=\s*'([^']*)'/)?.[1]
        || extractMetaContent(html, "og:title")
        || html.match(/<title>(.*?)<\/title>/is)?.[1];
    const desc = html.match(/var\s+msg_desc\s*=\s*htmlDecode\("([^"]*)"\)/)?.[1]
        || extractMetaContent(html, "og:description");
    const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gis)]
        .map((match) => cleanWhitespace(htmlDecode(stripTags(match[1]))))
        .filter((line) => line.length >= 8);
    const content = cleanWhitespace([
        desc ? htmlDecode(desc) : "",
        ...paragraphs.slice(0, 80),
    ].filter(Boolean).join("\n\n"));
    return {
        title: title ? cleanWhitespace(htmlDecode(stripTags(title))) : undefined,
        content: content || undefined,
    };
}
export async function fetchPageSummary(url) {
    const undici = await import("undici");
    const proxyUrl = getStandaloneHttpProxy()
        || process.env.WEIXIN_HTTP_PROXY?.trim()
        || process.env.HTTPS_PROXY?.trim()
        || process.env.HTTP_PROXY?.trim()
        || (getStandaloneDisableLocalProxy() ? undefined : "http://127.0.0.1:7890");
    const dispatcher = proxyUrl ? new undici.ProxyAgent(proxyUrl) : undefined;
    const res = await undici.fetch(url, {
        ...(dispatcher ? { dispatcher } : {}),
        headers: {
            "User-Agent": "Mozilla/5.0",
        },
    });
    if (!res.ok) {
        throw new Error(`抓取链接失败: HTTP ${res.status}`);
    }
    const html = await res.text();
    const { title, content } = extractWechatArticleText(html);
    if (!title && !content) {
        logger.warn(`fetchPageSummary: unable to extract useful text from ${url}`);
        return `链接: ${url}\n\n未能可靠提取正文，请根据链接标题和上下文谨慎回答。`;
    }
    const body = cleanWhitespace((content ?? "").slice(0, 12000));
    return [
        `链接: ${url}`,
        title ? `标题: ${title}` : "",
        body ? `正文摘录:\n${body}` : "",
    ].filter(Boolean).join("\n\n");
}
//# sourceMappingURL=web-page.js.map