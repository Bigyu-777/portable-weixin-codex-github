import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../storage/state-dir.js";
function resolveIdeaFile() {
    const configured = process.env.OPENCLAW_WEIXIN_IDEA_FILE?.trim();
    if (configured)
        return path.resolve(configured);
    return path.join(resolveStateDir(), "weixin", "ideas.jsonl");
}
function ensureParentDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
export function saveIdea(params) {
    const text = params.text.trim();
    if (!text) {
        throw new Error("Idea text is empty.");
    }
    const record = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        source: params.source,
        text,
    };
    const filePath = resolveIdeaFile();
    ensureParentDir(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
}
export function listRecentIdeas(limit = 10) {
    const filePath = resolveIdeaFile();
    if (!fs.existsSync(filePath))
        return [];
    const lines = fs
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const records = [];
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            if (parsed?.text)
                records.push(parsed);
        }
        catch {
            // Ignore malformed lines so one bad record doesn't break listing.
        }
    }
    return records.slice(-limit).reverse();
}
export function formatIdeasForReply(limit = 10) {
    const ideas = listRecentIdeas(limit);
    if (ideas.length === 0) {
        return "还没有记录任何想法。可以直接发 `/idea 你的想法`。";
    }
    return [
        `最近 ${ideas.length} 条灵感：`,
        ...ideas.map((idea, index) => {
            const when = idea.createdAt.replace("T", " ").replace("Z", " UTC");
            return `${index + 1}. [${when}] ${idea.text}`;
        }),
    ].join("\n");
}
//# sourceMappingURL=idea-store.js.map