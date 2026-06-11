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
function getHomeDir() {
    return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || "";
}
function cleanYamlScalar(value) {
    return String(value ?? "")
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\s+/g, " ");
}
function walkSkillFiles(rootDir, maxDepth = 10) {
    const results = [];
    const stack = [{ dir: rootDir, depth: 0 }];
    const seen = new Set();
    while (stack.length > 0 && results.length < 300) {
        const item = stack.pop();
        if (!item || seen.has(item.dir)) {
            continue;
        }
        seen.add(item.dir);
        let entries = [];
        try {
            entries = fs.readdirSync(item.dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(item.dir, entry.name);
            if (entry.isFile() && entry.name === "SKILL.md") {
                results.push(fullPath);
                continue;
            }
            if (entry.isDirectory() && item.depth < maxDepth && entry.name !== "node_modules") {
                stack.push({ dir: fullPath, depth: item.depth + 1 });
            }
        }
    }
    return results;
}
function inferPluginNameFromSkillPath(filePath) {
    const parts = filePath.split(path.sep);
    const cacheIndex = parts.lastIndexOf("cache");
    if (cacheIndex >= 0 && parts.length > cacheIndex + 2) {
        return parts[cacheIndex + 2];
    }
    return undefined;
}
function readSkillSummary(filePath) {
    const dirName = path.basename(path.dirname(filePath));
    let header = "";
    try {
        const content = fs.readFileSync(filePath, "utf8").slice(0, 4000);
        if (content.startsWith("---")) {
            const endIndex = content.indexOf("\n---", 3);
            header = endIndex >= 0 ? content.slice(3, endIndex) : content;
        }
        else {
            header = content;
        }
    }
    catch {
        header = "";
    }
    const name = cleanYamlScalar(header.match(/^name:\s*(.+)$/m)?.[1]) || dirName;
    const description = cleanYamlScalar(header.match(/^description:\s*(.+)$/m)?.[1]);
    const pluginName = inferPluginNameFromSkillPath(filePath);
    const qualifiedName = pluginName ? `${pluginName}:${name}` : name;
    return {
        name,
        qualifiedName,
        dirName,
        description,
        filePath,
        pluginName,
    };
}
function listSkillCatalog(filter = "") {
    const home = getHomeDir();
    const roots = [
        path.join(home, ".codex", "skills"),
        path.join(home, ".agents", "skills"),
        path.join(home, ".codex", "plugins", "cache"),
    ];
    const needle = filter.trim().toLowerCase();
    const byQualifiedName = new Map();
    for (const root of roots) {
        for (const filePath of walkSkillFiles(root)) {
            const item = readSkillSummary(filePath);
            const haystack = [
                item.qualifiedName,
                item.name,
                item.dirName,
                item.pluginName,
                item.description,
            ].filter(Boolean).join(" ").toLowerCase();
            if (needle && !haystack.includes(needle)) {
                continue;
            }
            byQualifiedName.set(item.qualifiedName.toLowerCase(), item);
        }
    }
    return Array.from(byQualifiedName.values())
        .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
}
function findSkillByName(rawName) {
    const needle = rawName.trim().toLowerCase();
    if (!needle) {
        return undefined;
    }
    const catalog = listSkillCatalog();
    const exact = catalog.find((item) => item.qualifiedName.toLowerCase() === needle ||
        item.name.toLowerCase() === needle ||
        item.dirName.toLowerCase() === needle);
    if (exact) {
        return exact;
    }
    return catalog.find((item) => item.qualifiedName.toLowerCase().includes(needle) ||
        item.name.toLowerCase().includes(needle) ||
        item.dirName.toLowerCase().includes(needle));
}
function formatSkillCatalog(filter = "") {
    const catalog = listSkillCatalog(filter);
    if (!catalog.length) {
        return filter
            ? `没有找到匹配的 skill：${filter}`
            : "没有扫描到本机 skill。";
    }
    const shown = catalog.slice(0, 30);
    const extra = catalog.length > shown.length ? [`还有 ${catalog.length - shown.length} 个未显示，可以用 /skills <关键词> 过滤。`] : [];
    return [
        filter ? `匹配 skills：${filter}` : "可用 skills：",
        ...shown.map((item, index) => {
            const desc = item.description ? ` - ${item.description.slice(0, 90)}` : "";
            return `${index + 1}. ${item.qualifiedName}${desc}`;
        }),
        ...extra,
        "",
        "用法：",
        "/skill <名称> - 设为当前联系人默认 skill",
        "/skill <名称> <任务> - 用指定 skill 处理这条任务",
        "/skill off - 关闭默认 skill",
    ].join("\n");
}
function listPluginCatalog(filter = "") {
    const home = getHomeDir();
    const cacheRoot = path.join(home, ".codex", "plugins", "cache");
    const needle = filter.trim().toLowerCase();
    const plugins = [];
    let marketplaces = [];
    try {
        marketplaces = fs.readdirSync(cacheRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }
    for (const marketplace of marketplaces) {
        if (!marketplace.isDirectory()) {
            continue;
        }
        const marketplaceDir = path.join(cacheRoot, marketplace.name);
        let pluginDirs = [];
        try {
            pluginDirs = fs.readdirSync(marketplaceDir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const pluginDir of pluginDirs) {
            if (!pluginDir.isDirectory()) {
                continue;
            }
            const pluginPath = path.join(marketplaceDir, pluginDir.name);
            let versionDirs = [];
            try {
                versionDirs = fs.readdirSync(pluginPath, { withFileTypes: true })
                    .filter((entry) => entry.isDirectory())
                    .map((entry) => entry.name)
                    .sort();
            }
            catch {
                versionDirs = [];
            }
            const version = versionDirs[versionDirs.length - 1] ?? "";
            const rootPath = version ? path.join(pluginPath, version) : pluginPath;
            const item = {
                name: pluginDir.name,
                marketplace: marketplace.name,
                version,
                rootPath,
                skillCount: walkSkillFiles(rootPath, 6).length,
            };
            const haystack = [item.name, item.marketplace, item.version].join(" ").toLowerCase();
            if (!needle || haystack.includes(needle)) {
                plugins.push(item);
            }
        }
    }
    return plugins.sort((a, b) => `${a.marketplace}/${a.name}`.localeCompare(`${b.marketplace}/${b.name}`));
}
function findPluginByName(rawName) {
    const needle = rawName.trim().toLowerCase();
    if (!needle) {
        return undefined;
    }
    const catalog = listPluginCatalog();
    return catalog.find((item) => item.name.toLowerCase() === needle) ??
        catalog.find((item) => item.name.toLowerCase().includes(needle));
}
function formatPluginCatalog(filter = "") {
    const catalog = listPluginCatalog(filter);
    if (!catalog.length) {
        return filter
            ? `没有找到匹配的 plugin：${filter}`
            : "没有扫描到本机 plugin。";
    }
    return [
        filter ? `匹配 plugins：${filter}` : "可用 plugins：",
        ...catalog.slice(0, 30).map((item, index) => `${index + 1}. ${item.name} (${item.marketplace}${item.version ? `/${item.version}` : ""}, skills=${item.skillCount})`),
        "",
        "用法：",
        "/plugin <名称> - 设为当前联系人默认 plugin",
        "/plugin <名称> <任务> - 用指定 plugin 处理这条任务",
        "/plugin off - 关闭默认 plugin",
    ].join("\n");
}
function splitFirstToken(value) {
    const trimmed = value.trim();
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) {
        return [trimmed, ""];
    }
    return [trimmed.slice(0, spaceIdx), trimmed.slice(spaceIdx + 1).trim()];
}
function formatModeStatus(session) {
    return [
        `目标: ${session.goalObjective || "未设置"}`,
        `计划模式: ${session.planMode ? "开启" : "关闭"}`,
        `默认 skill: ${session.activeSkill || "未设置"}`,
        "默认图像处理 skill: image2",
        `默认 plugin: ${session.activePlugin || "未设置"}`,
    ].join("\n");
}
function formatMainMenu(session) {
    return [
        "菜单：回复数字即可",
        "1. 设置目标",
        session.planMode ? "2. 关闭计划模式" : "2. 打开计划模式",
        "3. 使用 skill",
        "4. 使用 plugin",
        "5. 查看当前状态",
        "6. 发送最近文件",
        "7. 新建会话",
        "",
        "也可以直接说：",
        "目标：优化微信 bridge",
        "开启计划模式",
        "用 pdf skill 总结刚才的文件",
        "用 github 插件查 CI",
        "",
        "回复 0 或 取消 可退出菜单。",
    ].join("\n");
}
function setPendingAction(peerId, pendingAction) {
    updatePeerSession(peerId, (previous) => ({
        ...previous,
        peerId,
        pendingAction: pendingAction
            ? {
                ...pendingAction,
                createdAt: Date.now(),
            }
            : undefined,
    }));
}
function clearPendingAction(peerId) {
    setPendingAction(peerId, undefined);
}
function getFreshPendingAction(session) {
    const pending = session?.pendingAction;
    if (!pending?.type) {
        return undefined;
    }
    const createdAt = Number(pending.createdAt || 0);
    if (createdAt > 0 && Date.now() - createdAt > 10 * 60 * 1000) {
        return undefined;
    }
    return pending;
}
function firstLine(value) {
    return String(value ?? "").trim().split(/\r?\n/)[0]?.trim() || "";
}
function parseNumberChoice(text) {
    const match = text.trim().match(/^(?:选|选择)?\s*([0-9]+)$/);
    return match ? Number(match[1]) : undefined;
}
function isCancelText(text) {
    return /^(0|取消|退出|算了|不用了|cancel|q|quit)$/i.test(text.trim());
}
function isBackToMenuText(text) {
    return /^(菜单|menu|m)$/i.test(text.trim());
}
function formatPopularSkills() {
    const preferred = ["pdf", "docx", "pptx", "playwright", "github", "image2", "nature-reader", "humanizer"];
    const catalog = listSkillCatalog();
    const picked = [];
    for (const name of preferred) {
        const item = catalog.find((skill) => skill.qualifiedName.toLowerCase() === name ||
            skill.name.toLowerCase() === name ||
            skill.dirName.toLowerCase() === name);
        if (item && !picked.some((existing) => existing.qualifiedName === item.qualifiedName)) {
            picked.push(item);
        }
    }
    for (const item of catalog) {
        if (picked.length >= 8) {
            break;
        }
        if (!picked.some((existing) => existing.qualifiedName === item.qualifiedName)) {
            picked.push(item);
        }
    }
    if (!picked.length) {
        return "没有扫描到 skill。";
    }
    return [
        "选择 skill，回复数字或名称：",
        ...picked.map((item, index) => `${index + 1}. ${item.qualifiedName}`),
        "",
        "也可以直接发 skill 名称，例如：pdf",
        "回复 0 取消。",
    ].join("\n");
}
function formatPopularPlugins() {
    const catalog = listPluginCatalog();
    if (!catalog.length) {
        return "没有扫描到 plugin。";
    }
    return [
        "选择 plugin，回复数字或名称：",
        ...catalog.slice(0, 8).map((item, index) => `${index + 1}. ${item.name}`),
        "",
        "也可以直接发 plugin 名称，例如：github",
        "回复 0 取消。",
    ].join("\n");
}
function resolveSkillFromChoice(input) {
    const trimmed = input.trim();
    const choice = parseNumberChoice(trimmed);
    if (choice != null) {
        const popular = formatPopularSkillItems();
        return popular[choice - 1];
    }
    return findSkillByName(trimmed);
}
function formatPopularSkillItems() {
    const preferred = ["pdf", "docx", "pptx", "playwright", "github", "image2", "nature-reader", "humanizer"];
    const catalog = listSkillCatalog();
    const picked = [];
    for (const name of preferred) {
        const item = catalog.find((skill) => skill.qualifiedName.toLowerCase() === name ||
            skill.name.toLowerCase() === name ||
            skill.dirName.toLowerCase() === name);
        if (item && !picked.some((existing) => existing.qualifiedName === item.qualifiedName)) {
            picked.push(item);
        }
    }
    for (const item of catalog) {
        if (picked.length >= 8) {
            break;
        }
        if (!picked.some((existing) => existing.qualifiedName === item.qualifiedName)) {
            picked.push(item);
        }
    }
    return picked;
}
function resolvePluginFromChoice(input) {
    const trimmed = input.trim();
    const choice = parseNumberChoice(trimmed);
    const catalog = listPluginCatalog();
    if (choice != null) {
        return catalog.slice(0, 8)[choice - 1];
    }
    return findPluginByName(trimmed);
}
function normalizeNaturalText(text) {
    return text.trim().replace(/\s+/g, " ");
}
function naturalCommandToSlash(text) {
    const raw = text.trim();
    const normalized = normalizeNaturalText(raw);
    if (!normalized || raw.startsWith("/")) {
        return undefined;
    }
    const lower = normalized.toLowerCase();
    let match = normalized.match(/^(?:目标|设置目标|长期目标|goal)\s*[:：]\s*(.+)$/i);
    if (match?.[1]?.trim()) {
        return `/goal ${match[1].trim()}`;
    }
    match = normalized.match(/^(?:把目标设为|设置目标为|目标设为)\s*(.+)$/i);
    if (match?.[1]?.trim()) {
        return `/goal ${match[1].trim()}`;
    }
    if (/^(?:清除|关闭|取消)(?:当前)?目标$/.test(normalized)) {
        return "/goal clear";
    }
    if (/^(?:开启|打开|启用)(?:计划模式|plan模式|plan mode)$/.test(normalized) ||
        /^(?:计划模式|plan模式|plan mode)(?:开启|打开|启用)$/.test(normalized)) {
        return "/plan";
    }
    if (/^(?:关闭|取消|停止)(?:计划模式|plan模式|plan mode)$/.test(normalized) ||
        /^(?:计划模式|plan模式|plan mode)(?:关闭|取消|停止)$/.test(normalized)) {
        return "/plan off";
    }
    match = normalized.match(/^(?:计划一下|帮我规划|用计划模式)\s*(.+)$/i);
    if (match?.[1]?.trim()) {
        return `/plan ${match[1].trim()}`;
    }
    match = normalized.match(/^用\s+([A-Za-z0-9_.:-]+)\s+(?:skill|技能)\s*(.*)$/i);
    if (match?.[1]) {
        return `/skill ${match[1]}${match[2]?.trim() ? ` ${match[2].trim()}` : ""}`;
    }
    match = normalized.match(/^(?:使用|启用|设置)\s*([A-Za-z0-9_.:-]+)\s*(?:skill|技能)\s*(.*)$/i);
    if (match?.[1]) {
        return `/skill ${match[1]}${match[2]?.trim() ? ` ${match[2].trim()}` : ""}`;
    }
    match = normalized.match(/^用\s+([A-Za-z0-9_.:-]+)\s*(?:plugin|插件)\s*(.*)$/i);
    if (match?.[1]) {
        return `/plugin ${match[1]}${match[2]?.trim() ? ` ${match[2].trim()}` : ""}`;
    }
    match = normalized.match(/^(?:使用|启用|设置)\s*([A-Za-z0-9_.:-]+)\s*(?:plugin|插件)\s*(.*)$/i);
    if (match?.[1]) {
        return `/plugin ${match[1]}${match[2]?.trim() ? ` ${match[2].trim()}` : ""}`;
    }
    if (/^(?:状态|当前状态|模式|查看状态)$/.test(normalized)) {
        return "/mode";
    }
    if (/^(?:帮助|菜单|命令|怎么用)$/.test(normalized) || lower === "help") {
        return "/menu";
    }
    return undefined;
}
async function handlePendingAction(rawText, ctx, pendingAction) {
    const text = rawText.trim();
    switch (pendingAction.type) {
        case "menu": {
            const choice = parseNumberChoice(text);
            if (choice === 1) {
                setPendingAction(ctx.peerId, { type: "await-goal" });
                return {
                    handled: true,
                    reply: "把目标发给我就行。\n例如：优化微信 bridge，让它更适合手机操作\n回复 0 取消。",
                };
            }
            if (choice === 2) {
                const session = getPeerSession(ctx.peerId);
                return await handleStandaloneCommand(session.planMode ? "/plan off" : "/plan", ctx);
            }
            if (choice === 3) {
                setPendingAction(ctx.peerId, { type: "await-skill" });
                return { handled: true, reply: formatPopularSkills() };
            }
            if (choice === 4) {
                setPendingAction(ctx.peerId, { type: "await-plugin" });
                return { handled: true, reply: formatPopularPlugins() };
            }
            if (choice === 5) {
                clearPendingAction(ctx.peerId);
                return await handleStandaloneCommand("/mode", ctx);
            }
            if (choice === 6) {
                clearPendingAction(ctx.peerId);
                return await handleStandaloneCommand("/send", ctx);
            }
            if (choice === 7) {
                clearPendingAction(ctx.peerId);
                return await handleStandaloneCommand("/new", ctx);
            }
            return {
                handled: true,
                reply: [
                    "我没看懂这个选择。请回复 1-7。",
                    "",
                    formatMainMenu(getPeerSession(ctx.peerId)),
                ].join("\n"),
            };
        }
        case "await-goal": {
            clearPendingAction(ctx.peerId);
            return await handleStandaloneCommand(`/goal ${text}`, ctx);
        }
        case "await-skill": {
            const skill = resolveSkillFromChoice(text);
            if (!skill) {
                return {
                    handled: true,
                    reply: [
                        `没找到 skill：${text}`,
                        "",
                        "可以回复其他名称，或回复 0 取消。",
                    ].join("\n"),
                };
            }
            setPendingAction(ctx.peerId, {
                type: "await-skill-task",
                skillName: skill.qualifiedName,
                skillPath: skill.filePath,
            });
            return {
                handled: true,
                reply: [
                    `已选择 skill：${skill.qualifiedName}`,
                    "现在可以发任务，我会用这个 skill 处理。",
                    "如果只想设为默认 skill，回复：设为默认",
                    "回复 0 取消。",
                ].join("\n"),
            };
        }
        case "await-skill-task": {
            const skill = pendingAction.skillName
                ? findSkillByName(pendingAction.skillName)
                : undefined;
            if (!skill) {
                clearPendingAction(ctx.peerId);
                return { handled: true, reply: "这个 skill 已经找不到了，请重新打开 /menu 选择。" };
            }
            clearPendingAction(ctx.peerId);
            if (/^(设为默认|默认|保存|以后都用)$/i.test(text)) {
                return await handleStandaloneCommand(`/skill ${skill.qualifiedName}`, ctx);
            }
            return {
                handled: true,
                codexPrompt: buildSkillPrompt(skill, text),
            };
        }
        case "await-plugin": {
            const plugin = resolvePluginFromChoice(text);
            if (!plugin) {
                return {
                    handled: true,
                    reply: [
                        `没找到 plugin：${text}`,
                        "",
                        "可以回复其他名称，或回复 0 取消。",
                    ].join("\n"),
                };
            }
            setPendingAction(ctx.peerId, {
                type: "await-plugin-task",
                pluginName: plugin.name,
                pluginPath: plugin.rootPath,
            });
            return {
                handled: true,
                reply: [
                    `已选择 plugin：${plugin.name}`,
                    "现在可以发任务，我会优先用这个 plugin 处理。",
                    "如果只想设为默认 plugin，回复：设为默认",
                    "回复 0 取消。",
                ].join("\n"),
            };
        }
        case "await-plugin-task": {
            const plugin = pendingAction.pluginName
                ? findPluginByName(pendingAction.pluginName)
                : undefined;
            if (!plugin) {
                clearPendingAction(ctx.peerId);
                return { handled: true, reply: "这个 plugin 已经找不到了，请重新打开 /menu 选择。" };
            }
            clearPendingAction(ctx.peerId);
            if (/^(设为默认|默认|保存|以后都用)$/i.test(text)) {
                return await handleStandaloneCommand(`/plugin ${plugin.name}`, ctx);
            }
            return {
                handled: true,
                codexPrompt: buildPluginPrompt(plugin, text),
            };
        }
        default:
            clearPendingAction(ctx.peerId);
            return { handled: false };
    }
}
function buildSkillPrompt(skill, task) {
    return [
        `请使用 Codex skill：${skill.qualifiedName}`,
        `Skill 文件路径：${skill.filePath}`,
        "",
        "执行要求：",
        "1. 先读取并遵守这个 SKILL.md 的 workflow。",
        "2. 如果 SKILL.md 引用相对路径，以它所在目录为基准解析。",
        "3. 如果缺少外部工具或权限，明确说明限制并使用最佳 fallback。",
        "",
        `用户任务：${task}`,
    ].join("\n");
}
export function buildDefaultImageSkillPrompt(task) {
    const skill = findSkillByName("image2");
    if (!skill) {
        return undefined;
    }
    return buildSkillPrompt(skill, task);
}
function buildPluginPrompt(plugin, task) {
    return [
        `请优先使用 Codex plugin：${plugin.name}`,
        `Plugin 路径：${plugin.rootPath}`,
        "",
        "执行要求：",
        "1. 优先使用该 plugin 提供的 skills、MCP 或相关 CLI 能力。",
        "2. 如果需要具体 skill，请在 plugin 目录中查找对应 SKILL.md 并遵守 workflow。",
        "3. 如果该 plugin 无法直接满足任务，说明原因并使用最佳 fallback。",
        "",
        `用户任务：${task}`,
    ].join("\n");
}
function buildPlanPrompt(task) {
    return [
        "请以计划模式处理下面的任务。",
        "先给出简短计划；如果任务需要执行，请按计划推进，并在关键步骤后更新状态。",
        "如果任务很小，可以给一句话计划后直接完成。",
        "",
        `用户任务：${task}`,
    ].join("\n");
}
export function buildStandaloneModePrompt(userPrompt, session) {
    const prompt = userPrompt.trim();
    const context = [];
    if (session?.goalObjective) {
        context.push([
            "长期目标模式已开启。",
            `当前目标：${session.goalObjective}`,
            "请把用户这次消息当作推进该目标的下一步；如果用户明显切换话题，也要优先回应当前消息。",
        ].join("\n"));
    }
    if (session?.planMode) {
        context.push([
            "计划模式已开启。",
            "对于多步骤任务，请先给出简短计划再执行；执行过程中保持进展可见。",
        ].join("\n"));
    }
    if (session?.activeSkill) {
        context.push([
            `默认 skill 已开启：${session.activeSkill}`,
            session.activeSkillPath ? `Skill 文件路径：${session.activeSkillPath}` : "",
            "处理任务前请读取并遵守该 skill 的 SKILL.md；如果不适用，请说明原因。",
        ].filter(Boolean).join("\n"));
    }
    if (session?.activePlugin) {
        context.push([
            `默认 plugin 已开启：${session.activePlugin}`,
            session.activePluginPath ? `Plugin 路径：${session.activePluginPath}` : "",
            "请优先使用该 plugin 相关能力；如果不适用，请说明原因。",
        ].filter(Boolean).join("\n"));
    }
    if (!context.length) {
        return prompt;
    }
    return [
        "[微信桥接器上下文]",
        ...context,
        "",
        "[用户消息]",
        prompt,
    ].join("\n\n");
}
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
    const currentSession = getPeerSession(ctx.peerId);
    const pendingAction = getFreshPendingAction(currentSession);
    if (pendingAction && !text.startsWith("/")) {
        if (isCancelText(text)) {
            clearPendingAction(ctx.peerId);
            return { handled: true, reply: "已取消当前操作。" };
        }
        if (isBackToMenuText(text)) {
            setPendingAction(ctx.peerId, { type: "menu" });
            return { handled: true, reply: formatMainMenu(currentSession) };
        }
        return await handlePendingAction(text, ctx, pendingAction);
    }
    if (!text.startsWith("/")) {
        const slash = naturalCommandToSlash(text);
        if (!slash)
            return { handled: false };
        return await handleStandaloneCommand(slash, ctx);
    }
    const spaceIdx = text.indexOf(" ");
    const command = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();
    switch (command) {
        case "/m":
        case "/menu": {
            setPendingAction(ctx.peerId, { type: "menu" });
            return {
                handled: true,
                reply: formatMainMenu(getPeerSession(ctx.peerId)),
            };
        }
        case "/g":
            return await handleStandaloneCommand(`/goal ${args}`, ctx);
        case "/p":
            return await handleStandaloneCommand(args ? `/plan ${args}` : "/plan", ctx);
        case "/s":
            return await handleStandaloneCommand(args ? `/skill ${args}` : "/skill", ctx);
        case "/pl":
            return await handleStandaloneCommand(args ? `/plugin ${args}` : "/plugin", ctx);
        case "/st":
        case "/status":
            return await handleStandaloneCommand("/mode", ctx);
        case "/help":
            return {
                handled: true,
                reply: [
                    "可用命令：",
                    "/m 或 /menu - 打开微信菜单，回复数字操作",
                    "/g <目标> - 设置目标",
                    "/p [任务] - 打开计划模式，或对任务使用一次计划模式",
                    "/s [skill] [任务] - 查看/设置/使用 skill",
                    "/pl [plugin] [任务] - 查看/设置/使用 plugin",
                    "/st - 查看状态",
                    "/help - 查看帮助",
                    "/where - 查看当前保存目录",
                    "/ls - 查看当前会话目录内容",
                    "/model - 查看当前模型和可选模型",
                    "/model <编号|模型名> - 切换当前联系人使用的模型",
                    "/effort - 查看当前思考程度和可选档位",
                    "/effort <编号|档位> - 切换当前联系人使用的思考程度",
                    "/goal - 查看当前目标",
                    "/goal <目标> - 设置当前联系人长期目标",
                    "/goal clear - 清除当前目标",
                    "/plan - 打开计划模式",
                    "/plan off - 关闭计划模式",
                    "/plan <任务> - 对这条任务使用一次计划模式",
                    "/skills [关键词] - 查看本机可用 skills",
                    "/skill <名称> - 设为默认 skill",
                    "/skill <名称> <任务> - 用指定 skill 处理这条任务",
                    "/skill off - 关闭默认 skill",
                    "/plugins [关键词] - 查看本机可用 plugins",
                    "/plugin <名称> - 设为默认 plugin",
                    "/plugin <名称> <任务> - 用指定 plugin 处理这条任务",
                    "/plugin off - 关闭默认 plugin",
                    "/mode - 查看 goal/plan/skill/plugin 状态",
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
                    "",
                    formatModeStatus(session),
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
        case "/mode": {
            const session = getPeerSession(ctx.peerId);
            return {
                handled: true,
                reply: formatModeStatus(session),
            };
        }
        case "/goal": {
            const normalized = args.trim().toLowerCase();
            const session = getPeerSession(ctx.peerId);
            if (!args || normalized === "status") {
                return {
                    handled: true,
                    reply: [
                        session.goalObjective
                            ? `当前目标：${session.goalObjective}`
                            : "当前还没有设置目标。",
                        "",
                        "用法：",
                        "/goal <目标> - 设置长期目标",
                        "/goal clear - 清除目标",
                    ].join("\n"),
                };
            }
            if (["clear", "off", "reset", "关闭", "清除"].includes(normalized)) {
                updatePeerSession(ctx.peerId, (previous) => ({
                    ...previous,
                    peerId: ctx.peerId,
                    goalObjective: undefined,
                    goalUpdatedAt: Date.now(),
                }));
                return { handled: true, reply: "已清除当前联系人目标。" };
            }
            updatePeerSession(ctx.peerId, (previous) => ({
                ...previous,
                peerId: ctx.peerId,
                goalObjective: args,
                goalUpdatedAt: Date.now(),
            }));
            return {
                handled: true,
                reply: [
                    "已设置当前联系人长期目标。",
                    `目标：${args}`,
                    "之后的普通消息会自动带上这个目标上下文。发送 /goal clear 可清除。",
                ].join("\n"),
            };
        }
        case "/plan": {
            const normalized = args.trim().toLowerCase();
            if (!args || ["on", "open", "start", "开启", "打开"].includes(normalized)) {
                updatePeerSession(ctx.peerId, (previous) => ({
                    ...previous,
                    peerId: ctx.peerId,
                    planMode: true,
                    planModeUpdatedAt: Date.now(),
                }));
                return { handled: true, reply: "计划模式已开启。之后的普通消息会先规划再执行；发送 /plan off 可关闭。" };
            }
            if (["off", "close", "stop", "关闭", "停止"].includes(normalized)) {
                updatePeerSession(ctx.peerId, (previous) => ({
                    ...previous,
                    peerId: ctx.peerId,
                    planMode: false,
                    planModeUpdatedAt: Date.now(),
                }));
                return { handled: true, reply: "计划模式已关闭。" };
            }
            if (normalized === "status") {
                const session = getPeerSession(ctx.peerId);
                return { handled: true, reply: `计划模式：${session.planMode ? "开启" : "关闭"}` };
            }
            return {
                handled: true,
                codexPrompt: buildPlanPrompt(args),
            };
        }
        case "/skills": {
            return {
                handled: true,
                reply: formatSkillCatalog(args),
            };
        }
        case "/skill": {
            const normalized = args.trim().toLowerCase();
            if (!args || normalized === "status") {
                const session = getPeerSession(ctx.peerId);
                return {
                    handled: true,
                    reply: [
                        `默认 skill: ${session.activeSkill || "未设置"}`,
                        session.activeSkillPath ? `路径: ${session.activeSkillPath}` : "",
                        "",
                        "用法：",
                        "/skills [关键词] - 搜索 skill",
                        "/skill <名称> - 设为默认 skill",
                        "/skill <名称> <任务> - 只对这条任务使用 skill",
                        "/skill off - 关闭默认 skill",
                    ].filter(Boolean).join("\n"),
                };
            }
            if (normalized === "list") {
                return { handled: true, reply: formatSkillCatalog() };
            }
            if (["off", "clear", "reset", "关闭", "清除"].includes(normalized)) {
                updatePeerSession(ctx.peerId, (previous) => ({
                    ...previous,
                    peerId: ctx.peerId,
                    activeSkill: undefined,
                    activeSkillPath: undefined,
                }));
                return { handled: true, reply: "已关闭当前联系人默认 skill。" };
            }
            const [name, task] = splitFirstToken(args);
            const skill = findSkillByName(name);
            if (!skill) {
                return {
                    handled: true,
                    reply: [
                        `没有找到 skill：${name}`,
                        "",
                        formatSkillCatalog(name),
                    ].join("\n"),
                };
            }
            if (!task) {
                updatePeerSession(ctx.peerId, (previous) => ({
                    ...previous,
                    peerId: ctx.peerId,
                    activeSkill: skill.qualifiedName,
                    activeSkillPath: skill.filePath,
                }));
                return {
                    handled: true,
                    reply: [
                        `已设置默认 skill：${skill.qualifiedName}`,
                        `路径：${skill.filePath}`,
                        "之后的普通消息会自动要求 Codex 读取并遵守这个 skill。发送 /skill off 可关闭。",
                    ].join("\n"),
                };
            }
            return {
                handled: true,
                codexPrompt: buildSkillPrompt(skill, task),
            };
        }
        case "/plugins": {
            return {
                handled: true,
                reply: formatPluginCatalog(args),
            };
        }
        case "/plugin": {
            const normalized = args.trim().toLowerCase();
            if (!args || normalized === "status") {
                const session = getPeerSession(ctx.peerId);
                return {
                    handled: true,
                    reply: [
                        `默认 plugin: ${session.activePlugin || "未设置"}`,
                        session.activePluginPath ? `路径: ${session.activePluginPath}` : "",
                        "",
                        "用法：",
                        "/plugins [关键词] - 搜索 plugin",
                        "/plugin <名称> - 设为默认 plugin",
                        "/plugin <名称> <任务> - 只对这条任务使用 plugin",
                        "/plugin off - 关闭默认 plugin",
                    ].filter(Boolean).join("\n"),
                };
            }
            if (normalized === "list") {
                return { handled: true, reply: formatPluginCatalog() };
            }
            if (["off", "clear", "reset", "关闭", "清除"].includes(normalized)) {
                updatePeerSession(ctx.peerId, (previous) => ({
                    ...previous,
                    peerId: ctx.peerId,
                    activePlugin: undefined,
                    activePluginPath: undefined,
                }));
                return { handled: true, reply: "已关闭当前联系人默认 plugin。" };
            }
            const [name, task] = splitFirstToken(args);
            const plugin = findPluginByName(name);
            if (!plugin) {
                return {
                    handled: true,
                    reply: [
                        `没有找到 plugin：${name}`,
                        "",
                        formatPluginCatalog(name),
                    ].join("\n"),
                };
            }
            if (!task) {
                updatePeerSession(ctx.peerId, (previous) => ({
                    ...previous,
                    peerId: ctx.peerId,
                    activePlugin: plugin.name,
                    activePluginPath: plugin.rootPath,
                }));
                return {
                    handled: true,
                    reply: [
                        `已设置默认 plugin：${plugin.name}`,
                        `路径：${plugin.rootPath}`,
                        "之后的普通消息会优先使用这个 plugin。发送 /plugin off 可关闭。",
                    ].join("\n"),
                };
            }
            return {
                handled: true,
                codexPrompt: buildPluginPrompt(plugin, task),
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
