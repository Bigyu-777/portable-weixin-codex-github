# Portable Weixin Codex

[English](./README.md)

这是一个可独立部署的微信到 Codex 桥接项目，目标是把 Codex 会话直接接到微信里，并支持单账号或多账号常驻运行。

## 功能

- 微信扫码登录
- 每个联系人独立 `session` 目录
- 每个联系人独立 `Codex` 线程
- 支持按联系人切换模型 `/model`
- 支持按联系人切换思考程度 `/effort`
- 支持 `/send` 把引用文件直接回传给用户
- 支持多实例部署：一个微信号对应一个独立服务实例
- 提供 `systemd --user` 自启动模板

## 目录说明

- `dist/`：编译后的运行时代码
- `standalone-run.sh`：默认单账号启动脚本
- `standalone-instance.sh`：多实例启动脚本
- `standalone-config.json`：安全默认配置
- `standalone-config.example.json`：示例配置
- `deployment/systemd/`：systemd 用户服务模板

## 环境要求

- Node.js 22+
- 系统里能直接调用 `codex` CLI，或者你自行修改 `codexCommand`
- 如果要开机自启，建议使用 Linux + `systemd --user`

## 快速开始

### 单账号模式

```bash
npm install
./standalone-login.sh
./standalone-run.sh
```

### 多账号模式

创建一个独立实例，例如 `team1`：

```bash
./standalone-instance.sh team1 init
./standalone-instance.sh team1 login
./standalone-instance.sh team1 run
```

默认会生成隔离的运行目录：

- 状态目录：`~/.openclaw-weixin/team1`
- 会话目录：`./wecaht/team1`

## 开机自启

把 `deployment/systemd/` 下的服务文件复制到：

```bash
~/.config/systemd/user/
```

然后执行：

```bash
systemctl --user daemon-reload
systemctl --user enable --now weixin-codex-standalone.service
```

如果是多账号实例，例如 `team1`：

```bash
systemctl --user enable --now weixin-codex@team1.service
```

## 配置项

`standalone-config.json` 主要字段：

- `sessionRoot`：联系人会话目录根路径
- `httpProxy`：可选 HTTP 代理
- `disableLocalProxy`：是否禁用本地代理
- `codexCommand`：Codex CLI 路径
- `codexWorkdir`：执行 Codex 时的工作目录
- `codexTimeoutMs`：`0` 表示不设超时

## 微信命令

- `/help`：查看命令帮助
- `/where`：查看当前会话根目录和线程信息
- `/ls`：列出当前联系人会话目录中的文件
- `/model`：查看当前模型和可选模型
- `/model <编号|模型名>`：切换当前联系人的模型
- `/effort`：查看当前思考程度和可选档位
- `/effort <编号|档位>`：切换当前联系人的思考程度
- `/send`：优先把引用文件直接发回去
- `/send <文件名>`：在当前会话目录中模糊匹配并发送文件
- `/new`：为当前联系人创建一个新的会话目录和 Codex 线程
- `/reset`：清空当前联系人的绑定状态

## 安全说明

不要把运行态登录信息和会话数据提交到 GitHub。

高风险文件包括：

- `~/.openclaw/weixin-codex-direct/auth.json`
- `~/.openclaw/weixin-codex-direct/peer-sessions.json`
- `~/.openclaw/weixin-codex-direct/media-index.json`
- `~/.openclaw-weixin/<instance>/...`
- 本地 `wecaht/` 会话目录

详见 [SECURITY.md](./SECURITY.md)。

## 发布说明

这个副本已经按公开发布做过清理：

- 不包含真实 `auth.json`
- 不包含联系人会话缓存
- 不包含媒体索引
- 不包含本机实例运行配置

## 开发说明

- 当前仓库运行时代码位于 `dist/`
- 如果你直接修改了运行逻辑，请同步维护 `dist/` 内容
- 发布压缩包前，建议再次扫描 `token`、`auth`、`contextToken`、`Bearer`、`password` 等关键词
