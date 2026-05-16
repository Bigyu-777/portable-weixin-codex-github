# 微信直连 Codex 独立桥接部署说明

## 适用场景

这是一个不依赖 OpenClaw runtime 的独立版微信桥接器。

你可以把整个目录复制到另一台机器上使用，只要那台机器满足：

- 已安装 Node.js 22+
- 已安装并可运行 `codex`
- 能访问微信接口

## 目录里的关键文件

- `dist/`：编译后的可运行代码
- `node_modules/`：运行依赖
- `standalone-config.json`：独立配置文件
- `standalone-run.bat`：Windows 启动脚本

## 配置文件

编辑 `standalone-config.json`：

```json
{
  "sessionRoot": "F:\\weixin-codex-sessions",
  "httpProxy": "http://127.0.0.1:7890",
  "disableLocalProxy": false,
  "codexCommand": "",
  "codexWorkdir": "",
  "codexTimeoutMs": 180000
}
```

字段说明：

- `sessionRoot`
  每个微信会话保存文件的根目录。你以后可以直接改这里，不用改源码。
- `httpProxy`
  微信接口和网页抓取使用的代理，例如 `http://127.0.0.1:7890`。
- `disableLocalProxy`
  设为 `true` 时，不再默认使用本地 `7890` 代理。
- `codexCommand`
  `codex` 可执行文件路径。留空则默认尝试系统里的 `codex.exe`。
- `codexWorkdir`
  Codex 默认工作目录。留空则使用当前运行目录。
- `codexTimeoutMs`
  单次 Codex 执行超时时间，单位毫秒。

## 首次使用

在目录里打开终端：

```powershell
standalone-run.bat login
```

扫码登录后，启动桥接：

```powershell
standalone-run.bat run
```

## 日常使用

- 直接发文字：和 Codex 聊天
- 直接发文件/图片：只保存到当前 session，不自动处理
- 引用某个文件/图片再发文字：让 Codex 操作这个文件
- 如果 Codex 产出了当前 session 目录下的新文件，桥接器会优先直接把文件发回微信

## 常用命令

- `/help`
- `/where`
- `/ls`
- `/new`
- `/reset`
- `/thread`
- `/idea <内容>`
- `/ideas`

## 迁移到另一台机器

1. 复制整个目录
2. 确保新机器安装了 Node.js 22+ 和 Codex CLI
3. 修改 `standalone-config.json`
4. 运行 `standalone-run.bat login`
5. 运行 `standalone-run.bat run`

## 建议

- 建议把 `sessionRoot` 放在独立盘符，例如 `F:\\weixin-codex-sessions`
- 如果新机器的 `codex` 不在 PATH 里，直接把 `codexCommand` 写成绝对路径
