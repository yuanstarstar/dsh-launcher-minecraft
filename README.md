# 我的世界启动器（dsh-launcher-minecraft）

> 这是「DSH启动器」的**附属启动器**项目，不是 DSH 插件包。
> 安装后，启动器本体里才会出现 **Minecraft** 这个游戏；不安装它，启动器本体只是一个纯净的
> 启动器框架，里面没有任何具体游戏。

本包是一个独立、自包含的 zip 发行包：`minecraft-launcher-1.0.0.zip`。
核心（`@local/dsh-launcher`）负责界面、实例（游戏档案）管理、下载器与热加载；本包负责
Minecraft 专属逻辑：

- 版本清单与版本 json（官方 + 国内镜像自动回退）；
- Fabric / Quilt / Forge / NeoForge 加载器安装；
- Modrinth 模组搜索、版本解析、下载；
- Java 运行时探测与 Adoptium 自动下载；
- 生成启动参数（`buildLaunchSpec`，由核心负责真正 spawn 进程）。

## 为什么单独拆出来

| 项目 | 是否含游戏名 | 形态 | 安装方式 |
| --- | --- | --- | --- |
| `dsh-launcher-v3`（启动器本体） | 否，纯框架 | DSH 插件包 | 已随 DSH 安装 |
| **本项目 `dsh-launcher-minecraft`** | **是** | **独立 zip 包**（附属启动器） | 从 GitHub Releases 下载 / 面板安装 |

好处：启动器本体可以保持完全中立（代码与发行物中不出现任何具体游戏名），游戏支持通过
「附属启动器」独立升级、独立分发；Minecraft 更新了加载器或下载源，只需要发本包的新版本。

## 三种安装方式

### 方式一：面板「附属启动器」页添加 GitHub 仓库

1. 打开 DSH启动器 → 设置/面板 → **附属启动器** 页；
2. 填写 GitHub 仓库：`yuanstarstar/dsh-launcher-minecraft`；
3. 安装后数秒内自动热加载（核心每 2.5 秒轮询一次，**不需要重启**），新建实例时即可选择 Minecraft。

> 仓库需要发布 Release，并上传 `minecraft-launcher-<版本>.zip`（见「发布」一节）。

### 方式二：对话里让启动器安装

对启动器说：

```text
安装附属启动器，GitHub 仓库 yuanstarstar/dsh-launcher-minecraft
```

启动器会调用 `launcher_install_sublauncher` 工具，从 Release 下载 zip 并安装到
`<dataRoot>/sub-launchers/minecraft/<版本>/`，同时生成热加载桥文件。

### 方式三：本地 zip 文件安装

1. 从 Release 下载 `minecraft-launcher-1.0.0.zip`；
2. 在启动器「附属启动器」页选择「从文件安装」，或对启动器说：
   `用文件 <zip 绝对路径> 安装附属启动器`；
3. 安装后刷新/重启，游戏列表中出现 Minecraft。

> 安装/更新/卸载只影响 `<dataRoot>/sub-launchers/` 与 `<dataRoot>/adapters/`，
> 不会改动 DSH 本体与已下载的游戏数据（游戏数据在 `<dataRoot>/game-data/minecraft/`）。

## 卸载

- 面板「附属启动器」页点卸载；或删除 `<dataRoot>/sub-launchers/minecraft/` 与
  `<dataRoot>/adapters/sublauncher-minecraft.mjs`；
- 游戏数据（版本、库、资源、实例内容）位于 `<dataRoot>/game-data/minecraft/`，
  需要彻底清理时手动删除即可。

## 构建

需要 Node.js（项目内已带运行时可用绝对路径调用）。

```bash
node scripts/check-package.mjs   # 静态校验包结构（不联网）
node scripts/adapter-test.mjs    # 适配器自测（含真实网络用例；SKIP_NETWORK=1 可跳过）
node scripts/build-dist.mjs      # 产出 dist/minecraft-launcher-1.0.0.zip
```

`build:dist` 产物：

```text
dist/
  minecraft-launcher-1.0.0/
    launcher.json        <- 包根直接是 launcher.json（无外层文件夹）
    lib/index.mjs
    lib/*.js
    README.md
    LICENSE
    icon.svg
  minecraft-launcher-1.0.0.zip
```

构建脚本会自动回读 zip 中央目录，校验根目录含 `launcher.json`、`lib/index.mjs`，
且不含 `data/`、`test/`、`node_modules/`。

## 发布

1. 修改 `launcher.json` 与 `package.json` 的 `version`（两处必须一致）；
2. `node scripts/check-package.mjs && node scripts/adapter-test.mjs`；
3. `node scripts/build-dist.mjs`；
4. 在 GitHub 创建 Release，tag 建议 `v1.0.0`，上传 `dist/minecraft-launcher-1.0.0.zip`；
5. 确认仓库至少有一个 Release 且资产名以 `.zip` 结尾，面板安装即可发现。

## 包结构

```text
launcher.json           # 附属启动器清单（schemaVersion=1, id=minecraft, entry=lib/index.mjs）
lib/index.mjs           # entry：默认导出工厂函数 (helpers) => adapter
lib/adapter.js          # GameAdapter 实现（版本/安装/启动/校验/加载器/内容/运行时）
lib/mirrors.js          # 镜像规则唯一来源：resolveUrl -> 候选 URL（镜像优先、官方兜底）
lib/version.js          # 版本清单、版本 json、版本链合并、JVM/游戏参数模板
lib/vanilla.js          # 原版安装：client jar、libraries、natives、assets
lib/loaders.js          # Fabric/Quilt/Forge/NeoForge 加载器列表与安装
lib/modrinth.js         # Modrinth 搜索、版本解析、模组下载
lib/java.js             # Java 探测、Adoptium 下载安装
lib/launch.js           # buildLaunchSpec：生成启动参数（不 spawn）
lib/util.js             # 共享工具与 gameDataDir 目录布局
lib/zip.js              # Node 原生 zip 读取/解压（无第三方依赖）
scripts/check-package.mjs  # 静态校验
scripts/adapter-test.mjs   # 自测（假 ctx + 真实网络用例）
scripts/build-dist.mjs     # 构建 zip
```

数据布局（由核心注入 `dataRoot`）：

```text
<dataRoot>/
  game-data/minecraft/          # 本包共享游戏数据
    versions/                   # 版本 json + client jar + 加载器 profile
    libraries/                  # 依赖库
    assets/                     # 资源索引与对象
    runtime/                    # 自动下载的 Java 运行时（jre-17 / jre-21 ...）
    installers/                 # Forge/NeoForge 安装器缓存
    launcher_profiles.json
  instances/<实例id>/game/      # 实例游戏目录（mods、存档、配置）
```

## 能力矩阵

| 能力 | 支持 | 说明 |
| --- | --- | --- |
| 原版版本安装 | ✅ | 官方清单 + bmclapi/qlu 镜像自动回退 |
| Fabric / Quilt | ✅ | 下载 profile json 写入 versions |
| Forge / NeoForge | ✅（有条件） | 需运行官方安装器；NeoForge 依赖官方 maven 可达，见「已知风险」 |
| Modrinth 模组 | ✅ | 搜索/版本匹配/下载，优先稳定版与最新发布 |
| Java 运行时 | ✅ | 探测本机 + Adoptium 自动下载（清华镜像回退） |
| 中文错误提示 | ✅ | 所有失败路径抛出中文 Error |

## 已知风险

1. **NeoForge 安装器运行期依赖 `maven.neoforged.net`**：该域名在部分网络不可达，安装会失败
   并提示「NeoForge 官方 maven 当前不可达，请改用 Forge/Fabric，或稍后重试」。列表查询与
   安装器下载本身已走镜像。
2. **Forge 安装器耗时**：需下载约 6MB 安装器并运行 processors，首次安装 1~3 分钟属正常。
3. **Modrinth 下载速度**：部分网络下 CDN 较慢，模组下载可能耗时较久；下载器会显示进度。
4. **资源文件体积**：`assetsMode=full` 会下载数百 MB 资源；只想快速进游戏可改为 `index`。
5. **免登录离线账号**：当前只支持离线用户名（自动生成 UUID），暂未实现正版登录。
6. **平台**：优先支持 Windows；macOS/Linux 的 Java 探测与路径规则已兼容但未充分实测。

## 常见问题

**Q：安装后游戏列表里没有 Minecraft？**
A：确认 zip 根目录直接含 `launcher.json`（不能有外层文件夹）；确认核心版本 ≥ `3.2.0`；
等待 2.5 秒热加载或重启启动器；查看日志中是否有「附属启动器加载失败」提示。

**Q：启动提示找不到 Java？**
A：在实例设置里选择 Java 17/21，或让本包自动下载（需要网络）；也可以手动把 JDK 路径
配置到启动器设置的 `javaPath`。

**Q：下载很慢/失败？**
A：本包默认优先使用 bmclapi/qlu 镜像并自动回退官方源；可在核心配置里切换
`downloadSource`，或保持默认等待镜像恢复。

**Q：可以用正版账号吗？**
A：当前版本只支持离线用户名启动，正版登录待后续版本。

## 开发自测

`scripts/adapter-test.mjs` 使用假 AdapterContext 直接加载 `lib/index.mjs` 的工厂函数，
断言 GameAdapter 契约、镜像候选规则、真实版本清单/加载器/Modrinth 搜索（可 `SKIP_NETWORK=1`
跳过）、`buildLaunchSpec` 参数、verify/openFolder/removeContent 等。测试报告写入
`test/adapter-report.txt`，机器可读结果写入 `test/tmp/adapter-results.json`。

```bash
node scripts/adapter-test.mjs
SKIP_NETWORK=1 node scripts/adapter-test.mjs
```

## 许可证

MIT，见 [LICENSE](./LICENSE)。
