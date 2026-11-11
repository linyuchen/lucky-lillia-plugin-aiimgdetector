# 自动发布到 npm

[Publish to npm](https://github.com/linyuchen/lucky-lillia-plugin-aiimgdetector/actions/workflows/publish.yml) 在推送版本标签时运行全部单元与集成测试、构建并检查包内容，通过后发布已验证的同一份 tarball。浏览器端到端测试仍通过本地的 `npm run test:browser` 单独运行。

- 标签必须与 `package.json` 一致，例如版本 `1.0.0` 对应 `v1.0.0`。
- 正式版本发布到 `latest`；带预发布后缀的版本（例如 `1.1.0-beta.1`）发布到 `next`。
- Actions 页面上的 **Run workflow** 只验证、保存安装包，不发布 npm。安装包保留 14 天。

## 配置构建依赖

SDK 和 AI 服务当前尚未发布 npm，开发依赖使用本地 `file:` 路径。工作流会还原相同的目录结构：SDK 来自 `LuckyLilliaDev/LuckyLilliaBot` 的固定 V9 提交，AI 服务来自单独的源码仓库。

```text
LuckyLillia.Bot/
LuckyLillia.Plugins/
  lucky-lillia-plugin-aiprovider/
  lucky-lillia-plugin-aiimgdetector/
```

在本仓库 [Settings → Secrets and variables → Actions → Variables](https://github.com/linyuchen/lucky-lillia-plugin-aiimgdetector/settings/variables/actions) 配置：

| 变量 | 值 |
| --- | --- |
| `AIPROVIDER_REPOSITORY` | AI 服务的公开 GitHub 仓库，格式为 `owner/repository` |
| `AIPROVIDER_REF` | 对应版本的完整 40 位提交 SHA |

AI 服务仓库根目录需要有真实的 `src/`、`package.json`、`package-lock.json` 和 `tsconfig.json`，包名为 `lucky-lillia-aiprovider`，提供 `npm run build`。其本地 SDK 依赖路径需为 `file:../../LuckyLillia.Bot/packages/plugin-sdk`。当前工作流使用公开源码，不配置跨仓库私有访问凭证。缺少变量时会在安装前明确报错。

SDK 的提交固定在工作流中。更新 SDK 或 AI 服务后，先手动运行验证，再发布版本。

## 首次 npm 授权

推荐使用 npm **Trusted Publisher（OIDC）**，后续自动发布无需长期保存 npm token。工作流使用 GitHub 托管的 runner、Node 24，并检查 npm 至少为 11.5.1；发布任务具有 `id-token: write` 权限。

如果 npm 上还没有这个包，需要先由包所有者完成首次发布，才能在包的 Settings 页面配置 Trusted Publisher。可以在本地完成开发依赖安装、测试和构建后，用自己的 npm 账号登录并发布：

```sh
npm test
npm pack
npm login --registry=https://registry.npmjs.org/
npm publish ./lucky-lillia-plugin-aiimgdetector-1.0.0.tgz --access public --registry=https://registry.npmjs.org/
```

文件名以当前版本为准。此命令会实际发布版本；已经发布的版本不能重复发布。

包创建后，在 npm 包的 **Settings → Trusted Publisher** 中填写：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `linyuchen` |
| Repository | `lucky-lillia-plugin-aiimgdetector` |
| Workflow filename | `publish.yml` |
| Environment | 留空 |
| Allowed actions | 勾选 **Allow npm publish** |

字段区分大小写，Workflow filename 只填文件名。新建配置默认只允许暂存发布，需要明确允许 `npm publish`。新配置必须在 **2 天内**成功发布一次，否则需要删除并重新创建；因此请在准备下一次正式发布时配置。

如果选择让 Action 完成首次发布，可临时把 granular token 保存到 GitHub [Actions secret](https://github.com/linyuchen/lucky-lillia-plugin-aiimgdetector/settings/secrets/actions) `NPM_TOKEN`。它需要 **Read and write (publish and stage)** 和 **Bypass two-factor authentication**；未创建的无作用域包无法按已有包名单单独选择，通常需要更宽的 All Packages 权限，因此优先建议首次交互式发布。请在 GitHub 设置中填写 token，不要写入代码或聊天。

首次发布后配置 OIDC，并删除、撤销临时 token。npm 已宣布在 **2027 年 1 月**移除 granular token 直接发布新版本的能力，token 仅作为当前的首次发布过渡方案。

## 发布新版本

首次配置完成后，先在 Actions 页面手动运行验证。通过后在干净工作区执行：

```sh
npm version patch
git push origin main --follow-tags
```

`npm version patch` 会更新 `package.json` 和 lockfile、创建提交和版本标签。需要其他版本号时可替换为 `minor`、`major` 或具体版本。推送标签后自动发布；单独推送普通提交不会发布。

官方说明：[Trusted publishers](https://docs.npmjs.com/trusted-publishers/)、[访问令牌](https://docs.npmjs.com/about-access-tokens/)、[发布来源证明](https://docs.npmjs.com/generating-provenance-statements/)。
