# SynthID 使用说明

SynthID 默认关闭。启用后，只需配置当前账号的 `refresh_token`。检测通过宿主的 HTTP 服务完成：每张图片都会获取新的挑战、在独立 Node.js 子进程中执行官网下发的校验程序、生成新的上传路径和绑定该路径的校验凭据，然后上传原图并读取结果。检测不会启动 Chrome、控制浏览器或重放旧图片的 `bg_token`。

当前打包的原生运行时支持 **Windows x64、Node.js 24**。它包含该环境下验证通过的原生兼容模块；其他操作系统或 Node ABI 会明确报告运行环境不可用。运行时依赖已随插件声明，不需要安装浏览器来检测图片。

## 配置登录凭据

在插件设置里打开「SynthID 图片检测」，可用以下任一方式填写登录凭据，完成后点击弹窗底部「保存」。

### 自动登录

1. Bot 所在电脑安装 Chrome 或 Edge，并具有可交互桌面。
2. 点击 SynthID 设置内的「登录 SynthID」。窗口在 **Bot 所在电脑** 打开；远程访问 WebUI 时，也需在该电脑操作窗口。
3. 完成 Google 登录与 SynthID 首次使用提示。插件直接读取该账号的登录凭据，保存并填入表单，然后关闭登录窗口。

这一步不会上传测试图片或发起水印检测。检测也无需保留登录窗口。登录过程中可点击取消；登录错误只显示经过清理的信息，不会将失败请求当作有效凭据。

「清除浏览器会话」清除本插件的登录记录和独立浏览器资料，不影响平时使用的浏览器，也不删除配置中明确保存的登录凭据。配置为空时可恢复本插件以前保存的账号；明确填写的凭据优先。更换自动登录账号后，保存新表单即可切换检测账号。

### 手动填写

1. 在自己的浏览器打开 [synthid.com/image-detection](https://synthid.com/image-detection)，完成 Google 登录与首次使用提示。
2. 按 F12，在 **Application（应用）→ IndexedDB → firebaseLocalStorageDb → firebaseLocalStorage** 中展开当前账号对应的 `firebase:authUser:…` 记录。
3. 在 `value.stsTokenManager.refreshToken` 中复制完整值，不带外围引号，填写「登录凭据」。看不到记录时，确认登录完成，再刷新开发者工具的数据。

无需上传测试图片，也无需复制 `Push-Filename` 或 `X-Goog-Ext-525006476-Jspb`。这里需要的是 Firebase `refreshToken`，不是 Google 密码或短期的 `accessToken`。Bot 使用手动凭据时不需要桌面或浏览器。

旧配置中的 `pushFilename`、`bgToken` 仍按敏感字段遮罩，但不再用于检测。已保存字段的空白与遮罩处理遵循宿主设置流程；需要更换时填写新的完整值。

## 网络、队列与结果

所有检测请求均通过 `ctx.http.fetch()`，自动沿用 Bot「代理」插件的规则。可选登录窗口使用 `ctx.http.proxy()` 取得代理；旧宿主保留 HTTP 转发兼容。网络需能够访问 SynthID、Google 登录令牌服务、WAA 挑战服务和 Google 上传服务。

检测仅支持图片，最大 20 MB。原图会上传给 Google。队列按服务端刷新确认的账号 ID 串行处理，每账号最多 4 个正在处理或等待的任务；认证前也限制待处理图片数量。配置更新只影响后续请求。取消、超时和插件卸载会中止相应 HTTP 请求并清理解释器子进程。

每次检测使用一个截止时间；排队等待不消耗检测时间。服务明确拒绝登录时，只刷新并重试一次，重试会重新生成挑战、上传路径和校验凭据。普通 `RPC 7` 不自动重试或解释为登录失效。额度错误按服务提供的等待时间冷却。

| 状态 | 含义与处理 |
| --- | --- |
| 检出水印 | 显示「图片是 OpenAI 生成」等提示，来源以服务返回值为准 |
| 未检出 | 未检出支持的水印，不能据此确认是人工图片 |
| 无法判断 | 服务没有足够的信息，例如图片质量或细节不足 |
| 尚未登录或登录失效 | 自动登录，或更新当前账号的 `refresh_token` |
| 服务拒绝（RPC 7 / HTTP 403） | 当前请求未被接受，稍后重试；不视为未检出 |
| 额度用完 | 按提示等待，不重复上传 |
| 运行环境不可用 | 使用 Windows x64、Node.js 24，并确认插件运行时文件完整 |
| 无法识别结果 | 官网接口可能变化，不视为未检出 |

服务端接受情况可能随时间变化。2026-11-17，编译后的正式 HTTP 客户端通过宿主 HTTP 服务使用已保存账号完成真实检测，返回 `detected`、来源 `openai`；该结果证明当次链路可用，不保证服务始终接受所有请求。

## 数据保存

登录会话保存在 `ctx.storage.dir()/synthid-session/`。可选浏览器资料位于其中的 `browser/`，只属于本插件。自动获取凭据的接口受宿主 WebUI 鉴权保护，以当前凭据版本号校验并禁止缓存；普通状态接口不返回凭据。

轮换后的刷新令牌保存在 `ctx.storage.dir()/synthid-http/`，以原始登录凭据的 SHA-256 作为文件名，原子写入。重启后会再次向登录服务确认账号，不信任磁盘上的 JWT。旧版 `synthid-manual/` 缓存不会被自动作为新的账号身份来源。

凭据可代表你的账号，请勿分享、截图或提交到仓库。设置页遮罩不等于磁盘加密，Bot 配置和插件数据目录仍需妥善保管。挑战程序、页面 Cookie、上传路径和每图校验凭据只用于当前请求，不写入登录缓存或日志。

## 开发验证

运行 `npm run build` 和 `npm test`。测试使用本地 HTTP 服务和合成账号，覆盖参数绑定、原图上传、账号验证、队列、取消、限流、令牌轮换、配置更新和 WebUI 接口。

Windows x64、Node.js 24 下执行 `npm run test:runtime`，使用本地自编程序验证完整解释器运行时、快照、原生资源恢复与进程退出，不连接外网。安装 Chrome 或 Edge 后执行 `npm run test:browser`，验证可选登录、凭据读取、无测试图上传和代理；源码加载还可执行 `node ../../LuckyLillia.Bot/node_modules/tsx/dist/cli.mjs test/synthid-browser.mjs --source`。

`scripts/check-pack.mjs` 检查源码、编译目录中的运行时资源和原生模块。`scripts/smoke-synthid-runtime.mjs` 可接收安装后的 `entry.mjs` 路径，以验证干净 npm 安装及依赖提升后的实际布局。

结果协议参考 [sisi0318/synthid 的 PROTOCOL.md](https://github.com/sisi0318/synthid/blob/a4baf87fbe049950b9120a11a239348fd608c55a/PROTOCOL.md)。上游未提供标准 LICENSE，其 README 写有研究用途和商业集成限制；本插件的协议实现不代表上游发布授权已经明确。
