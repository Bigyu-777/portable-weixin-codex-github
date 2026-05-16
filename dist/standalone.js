import { loginStandaloneWeixin, logoutStandaloneWeixin, runStandaloneWeixinBridge, } from "./src/standalone/client.js";
async function main() {
    const command = process.argv[2]?.trim().toLowerCase() || "run";
    switch (command) {
        case "login":
            await loginStandaloneWeixin();
            return;
        case "logout":
            await logoutStandaloneWeixin();
            return;
        case "run":
            await runStandaloneWeixinBridge();
            return;
        default:
            console.log("用法: node standalone.ts <login|run|logout>");
    }
}
main().catch((err) => {
    console.error(String(err));
    process.exitCode = 1;
});
//# sourceMappingURL=standalone.js.map