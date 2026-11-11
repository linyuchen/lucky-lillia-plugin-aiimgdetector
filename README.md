# aiimgdetector

LuckyLillia Bot 的 AI 图片检测插件，npm 包名为 `lucky-lillia-plugin-aiimgdetector`。对着图片回复 `/ai吗`，或发送 `/ai吗` 并附图，使用 OpenAI 水印检测、可选的 SynthID 检测和看图模型判断图片是否由 AI 生成。指令前缀和无前缀触发跟随 Bot 的「指令」设置。

使用说明见 [插件详情](docs/details.md)。需要启用 `lucky-lillia-aiprovider`（AI 服务）插件；使用 OpenAI 或看图判断时还需配置相应服务。SynthID 默认关闭，打开「SynthID 检测」后，可点击组内「登录 SynthID」自动获取并填写凭证，也可直接手动填写三项凭证，然后保存。获取步骤见 [SynthID 接入说明](docs/synthid.md)。登录与检测自动沿用 Bot「代理」插件的设置。

## 本地开发

当前本地依赖按以下目录布局配置：

```text
LuckyLillia/
  LuckyLillia.Bot/
  LuckyLillia.Plugins/
    lucky-lillia-plugin-aiprovider/
    lucky-lillia-plugin-aiimgdetector/
```

先在已安装依赖的 Bot 仓库构建 SDK，再安装并构建 AI 服务：

```sh
npm run build:sdk
npm --prefix ../LuckyLillia.Plugins/lucky-lillia-plugin-aiprovider install
npm --prefix ../LuckyLillia.Plugins/lucky-lillia-plugin-aiprovider run build
```

再在本插件目录执行：

```sh
npm install
npm test
npm run build
npm pack --dry-run
```

SDK 和 AI 服务通过 `devDependencies` 的本地 `file:` 路径提供，发布兼容要求仍由 `peerDependencies` 和 `llbot.dependencies` 声明。SDK 或 AI 服务改动后，先重新构建对应依赖。

在 Bot 仓库启动并扫描两个插件：

```sh
npm run dev -- --plugin-dir ../LuckyLillia.Plugins
```

也可在 Bot 的 `data/plugins/` 中为本插件建立目录联接，然后点击「重新扫描」。首次安装的插件默认停用，需要在插件列表里启用。

`npm run dev` 在本插件目录持续编译源码；`npm publish` 前的 `prepack` 会重新构建。包中包含 `lib/`、`src/`、`webui/`、图标、详情和演示图。WebUI 使用宿主提供的 React，无需单独构建。SynthID 浏览器登录通过 playwright-core 使用本机 Chrome 或 Edge，安装 npm 包时不下载浏览器；手动获取并填写凭证不要求 Bot 安装浏览器。
