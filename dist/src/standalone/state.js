import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BASE_URL } from "../auth/accounts.js";
import { resolveStateDir } from "../storage/state-dir.js";
import { getStandaloneSessionRoot } from "./config.js";
function resolveStandaloneDir() {
    return path.join(resolveStateDir(), "weixin-codex-direct");
}
function readJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
function writeJsonFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}
export function loadStandaloneAuthState() {
    return readJsonFile(path.join(resolveStandaloneDir(), "auth.json"));
}
export function saveStandaloneAuthState(state) {
    writeJsonFile(path.join(resolveStandaloneDir(), "auth.json"), state);
}
export function clearStandaloneAuthState() {
    try {
        fs.unlinkSync(path.join(resolveStandaloneDir(), "auth.json"));
    }
    catch {
        // ignore missing file
    }
}
export function loadPeerSessions() {
    return readJsonFile(path.join(resolveStandaloneDir(), "peer-sessions.json")) ?? {};
}
export function savePeerSessions(sessions) {
    writeJsonFile(path.join(resolveStandaloneDir(), "peer-sessions.json"), sessions);
}
export function getPeerSession(peerId) {
    const sessions = loadPeerSessions();
    return sessions[peerId] ?? { peerId };
}
export function updatePeerSession(peerId, updater) {
    const sessions = loadPeerSessions();
    const next = updater(sessions[peerId] ?? { peerId });
    sessions[peerId] = next;
    savePeerSessions(sessions);
    return next;
}
export function clearPeerSession(peerId) {
    const sessions = loadPeerSessions();
    if (!(peerId in sessions))
        return;
    delete sessions[peerId];
    savePeerSessions(sessions);
}
export function resolveStandaloneBaseUrl() {
    return loadStandaloneAuthState()?.baseUrl?.trim() || DEFAULT_BASE_URL;
}
function sanitizePeerId(peerId) {
    return peerId.replace(/[\\/:*?"<>|@]/g, "_").replace(/\s+/g, "_");
}
function timestampKey(now = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        "-",
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join("");
}
export function resolveSessionRootDir() {
    const configured = process.env.WEIXIN_SESSION_ROOT?.trim() || getStandaloneSessionRoot();
    if (configured)
        return path.resolve(configured);
    if (process.platform === "win32") {
        return "F:\\weixin-codex-sessions";
    }
    return path.join(resolveStateDir(), "weixin-codex-sessions");
}
export function ensureSessionRootDir() {
    const root = resolveSessionRootDir();
    fs.mkdirSync(root, { recursive: true });
    return root;
}
export function createPeerSessionDir(peerId) {
    const root = ensureSessionRootDir();
    const dir = path.join(root, `${timestampKey()}-${sanitizePeerId(peerId)}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
export function ensurePeerSessionDir(peerId) {
    const existing = getPeerSession(peerId).sessionDir?.trim();
    if (existing) {
        fs.mkdirSync(existing, { recursive: true });
        return existing;
    }
    const next = createPeerSessionDir(peerId);
    updatePeerSession(peerId, (previous) => ({
        ...previous,
        peerId,
        sessionDir: next,
    }));
    return next;
}
export function startNewPeerSession(peerId) {
    const sessionDir = createPeerSessionDir(peerId);
    return updatePeerSession(peerId, (previous) => ({
        ...previous,
        peerId,
        threadId: undefined,
        sessionDir,
    }));
}
//# sourceMappingURL=state.js.map