# SiFlux 中转站一键导入（深链配置）

状态：应用侧与中转站页面侧的契约已定；桌面外壳已落地（Windows）。本文件是内部设计与对接契约，不是对用户承诺的产品文档。

## 1. 目标

客户端只对接 SiFlux 中转站。用户在应用里不该看到、也不该手工搬运密钥：在中转站页面上点一次「一键接入」，接口地址与密钥就写进客户端。

现状（2026-10-15 探测 `https://api.siflux.cn/api/status`）：

- 中转站是 New API `v1.0.0-rc.44`，`system_name: "SiFlux API"`。
- 已开启：`password_login_enabled`、`github_oauth`、`email_verification`。
- `/api/token/`、`/api/user/self` 需登录态；`/v1/*` 对浏览器开放。

## 2. 为什么用深链，而不是设备码授权

先评估过 RFC 8628 设备码授权（应用发起 → 浏览器确认 → 轮询换取密钥）。放弃的原因有两条，记在这里以免重复讨论：

1. New API 的登录态是中转站域名下的会话 Cookie，第三方本地客户端读不到，也没有「把凭证交回客户端」的出口。设备码方案需要中转站**新增**三组接口；而深链方案只需在既有的一键配置页上多一个分支，那一页已经会用用户登录态创建密钥。
2. 客户端只服务一个中转站，不需要一套能对接任意中转站的账号授权协议。深链 + 内置预设足够，且少一整块要维护的状态机。

代价是密钥会经过浏览器地址栏与操作系统参数。这是所有深链导入客户端的固有代价，缓解方式：密钥由页面创建为**专属可撤销**令牌（`SIFLUX-desktop`，用户可随时在后台删除）、应用内二次确认并显示来源主机、只按渠道配置的既有方式保存。

## 3. 深链契约

```
sifluxstudio://provider/import?v=1&data=<base64(JSON)>
```

`data` 为 `JSON.stringify` 后 base64 的载荷，字段名沿用中转站页面现有写法（与 Cherry Studio 一致）：

```json
{
  "name": "SIFLUX",
  "baseUrl": "https://api.siflux.cn/v1",
  "apiKey": "sk-..."
}
```

页面侧只需在 `buildLink` 里增加一个分支：

```js
if (kind === "sifluxstudio") {
  return "sifluxstudio://provider/import?v=1&data=" + encodeConfig({
    name: name,
    baseUrl: host + "/v1",   // 必须带 API 根路径，与渠道服务地址约定一致
    apiKey: apiKey
  });
}
```

约束：

- 只接受**本构建内置的那个中转站**（scheme + host 完全一致）。否则任意网页都能唤起协议，把凭证指向别的主机。
- 拒绝畸形链接：非 `v=1`、空载荷、非法 Base64、非 JSON、非 http(s)、相对地址、带 `user:pass@`、带查询或片段、超长、API Key 含空白。
- 畸形链接**不阻止应用启动**，只是被忽略并丢弃；否则用户会卡在没有窗口的状态。
- 一键导入不带 `key_id`，应用无法代为撤销，断开时提示到中转站后台删除该令牌。
- 令牌名沿用页面已有的 `SIFLUX-desktop`，不新建。

## 4. 应用侧

### 4.1 模块边界

- `backend/internal/relayconnect`：深链契约的唯一实现（解析、校验、编码）。**不访问网络**，不保存凭证——它把不可信的 OS 输入变成经过校验的载荷，仅此而已。
- `backend/cmd/desktop`：注册协议、收敛启动参数、把载荷交给前端。
- 前端：确认与写入渠道配置。密钥仍按 AGENTS.md 第 5 节的既有约定保存在渠道配置里，导入只是换一种「怎么拿到密钥」的方式。

### 4.2 桌面外壳（Windows 已落地）

1. **协议注册**：`HKCU\Software\Classes\sifluxstudio`，每次启动刷新 exe 路径，per-user 无需管理员，与安装包权限模型一致。macOS 需在打包的 Info.plist 声明 `CFBundleURLTypes`，Linux 需在 `.desktop` 里声明 `x-scheme-handler/sifluxstudio`。
2. **单实例转发**：本地后端监听 `127.0.0.1:0`（动态端口），没有单实例机制时点链接会起第二个进程抢同一 data dir。用 Wails 的 `SingleInstanceLock` + `OnSecondInstanceLaunch` 转交 URL。
3. **参数守卫**：`validateDesktopArgs` 放行且最多接收一个协议链接，其余非平台参数照旧拒绝。
4. **交给前端**：
   - 事件 `relay:import`，参数 `{name, baseUrl, apiKey}`（窗口已存在时送达）。
   - `GET /__desktop/relay-import` 返回同一结构，取走即清空，无待确认时为 `null`（协议唤起早于窗口创建，单靠事件会漏）。
   - 走 AssetServer 路由而非绑定方法：`TestDesktopAppBoundMethodsStayTiny` 锁定了反射出去的 API 集合，绑定面必须保持极小。
   - 非桌面环境该路由不存在，前端需静默降级为仅手动填写。

### 4.3 前端（待接线）

监听事件 + 挂载时轮询，按 `baseUrl + name` 去重；弹窗显示来源主机；确认后把 `baseUrl` 与密钥写入内置「SiFlux 中转站」渠道并拉取模型列表；完成后提示「已从 SIFLUX 导入」。

## 5. 切片与验证

| 切片 | 内容 | 验证 |
| --- | --- | --- |
| 1 | 深链契约（本文档 + 页面侧格式） | 契约字段与页面侧实现一致 |
| 2 | `relayconnect`：解析/校验/编码 | 已落地：`go vet` 干净，5 个用例覆盖往返、页面真实产物（`btoa` + `encodeURIComponent`）、URL-safe Base64、9 类畸形链接、7 类不安全载荷、origin 归一 |
| 3 | 桌面外壳：协议注册、单实例、参数守卫 | 已落地（Windows）：桌面包全量通过，7 个定向用例含注册表真实读写（并抓出双反斜杠 bug）；macOS/Linux 待打包元数据 |
| 4 | 前端：确认弹窗 + 写入渠道 | `bun run build`、`bun run lint`、浏览器验收导入流程 |
| 5 | 中转站页面增加本应用入口 | 页面侧改动后联调 |
| 6 | 文档同步（`http-api.mdx`、`features.mdx`）与实施记录 | 文档站类型检查 |

已删除：连接状态机、设备码客户端、后端凭证保管（曾实现并测过 20 例），因为落库位置定在渠道配置，那套机制没有任何调用方。

Windows 实测记录：注册表测试第一次运行就拓出真 bug——命令值曾用 `fmt.Sprintf("%q", ...)` 生成，写进注册表的是双反斜杠路径（`C:\\Program Files\\...`），Windows 解析不了，协议会静默失效。已改为 `"...exe" "%1"`。另外注意：首次验证时用 `-run "Relay|Desktop"` 并没有匹配到注册表测试，那次「绿」是假绿，改 `-v` 逐条核对才发现。
