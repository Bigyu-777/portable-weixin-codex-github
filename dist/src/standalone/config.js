import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
function resolveStandaloneConfigPath() {
    const configured = process.env.WEIXIN_STANDALONE_CONFIG?.trim();
    if (configured)
        return path.resolve(configured);
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(currentDir, "..", "..", "standalone-config.json");
}
function readConfigFile() {
    const filePath = resolveStandaloneConfigPath();
    try {
        if (!fs.existsSync(filePath))
            return {};
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch {
        return {};
    }
}
let cachedConfig = null;
export function loadStandaloneConfig() {
    if (cachedConfig)
        return cachedConfig;
    cachedConfig = readConfigFile();
    return cachedConfig;
}
export function getStandaloneSessionRoot() {
    return loadStandaloneConfig().sessionRoot?.trim() || undefined;
}
export function getStandaloneHttpProxy() {
    return loadStandaloneConfig().httpProxy?.trim() || undefined;
}
export function getStandaloneDisableLocalProxy() {
    return loadStandaloneConfig().disableLocalProxy === true;
}
export function getStandaloneCodexCommand() {
    return loadStandaloneConfig().codexCommand?.trim() || undefined;
}
export function getStandaloneCodexWorkdir() {
    return loadStandaloneConfig().codexWorkdir?.trim() || undefined;
}
export function getStandaloneCodexTimeoutMs() {
    const value = loadStandaloneConfig().codexTimeoutMs;
    if (Number.isFinite(value)) {
        return Number(value);
    }
    return undefined;
}
export function getStandaloneConfigPath() {
    return resolveStandaloneConfigPath();
}
//# sourceMappingURL=config.js.map
