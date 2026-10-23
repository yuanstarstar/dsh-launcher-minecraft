// scripts/check-package.mjs —— 附属启动器包静态校验（不联网、无需宿主）
//
// 校验依据：dsh-launcher-v3/docs/ARCHITECTURE-v4.md §1「附属启动器包格式」。
// 覆盖：
//   1) launcher.json 字段：schemaVersion/id/label/version/entry/minCoreVersion 等；
//   2) 入口文件存在、位于包内、默认导出工厂函数，且调用后返回合法 GameAdapter；
//   3) package.json 与 launcher.json 版本一致、包结构完整（README/LICENSE/icon/lib）；
//   4) 禁止项：旧 DSH 插件注册逻辑、核心包 import、data/node_modules 目录。
//
// 运行：node scripts/check-package.mjs
// 退出码：0 通过；1 失败。

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)

const failures = []
let checks = 0

function ok(label, detail = '') {
  checks += 1
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`)
}

function bad(label, reason) {
  failures.push(`${label}：${reason}`)
  console.log(`FAIL ${label} — ${reason}`)
}

function check(label, fn) {
  try {
    const detail = fn()
    ok(label, detail)
  } catch (error) {
    bad(label, error?.message ?? String(error))
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/
const REQUIRED_LIB = [
  'lib/index.mjs',
  'lib/adapter.js',
  'lib/mirrors.js',
  'lib/version.js',
  'lib/vanilla.js',
  'lib/loaders.js',
  'lib/modrinth.js',
  'lib/java.js',
  'lib/launch.js',
  'lib/util.js',
  'lib/zip.js',
]

/** 解析并校验 launcher.json */
async function checkLauncherJson() {
  const file = path.join(ROOT, 'launcher.json')
  const raw = await fsp.readFile(file, 'utf8')
  let launcher
  try {
    launcher = JSON.parse(raw)
  } catch (error) {
    bad('launcher.json 可解析', `JSON 解析失败：${error.message}`)
    return null
  }
  ok('launcher.json 可解析', `${raw.length}B`)

  check('launcher.json schemaVersion = 1', () => {
    assert(launcher.schemaVersion === 1, `期望 1，实际 ${launcher.schemaVersion}`)
    return '1'
  })
  check('launcher.json id 合法', () => {
    assert(typeof launcher.id === 'string', 'id 缺失')
    assert(ID_RE.test(launcher.id), `id 不符合 ${ID_RE}：${launcher.id}`)
    return launcher.id
  })
  check('launcher.json label 非空', () => {
    assert(typeof launcher.label === 'string' && launcher.label.trim().length > 0, 'label 缺失')
    return launcher.label
  })
  check('launcher.json version 为 semver', () => {
    assert(typeof launcher.version === 'string' && SEMVER.test(launcher.version), `非法版本号：${launcher.version}`)
    return launcher.version
  })
  check('launcher.json entry = lib/index.mjs', () => {
    assert(launcher.entry === 'lib/index.mjs', `entry 必须是 lib/index.mjs，实际 ${launcher.entry}`)
    return launcher.entry
  })
  check('launcher.json entry 文件存在且在包内', () => {
    const entryPath = path.resolve(ROOT, launcher.entry)
    assert(entryPath.startsWith(ROOT + path.sep), `entry 越界：${entryPath}`)
    assert(fs.existsSync(entryPath), `entry 文件不存在：${entryPath}`)
    return path.relative(ROOT, entryPath)
  })
  check('launcher.json minCoreVersion 为 semver', () => {
    assert(
      typeof launcher.minCoreVersion === 'string' && SEMVER.test(launcher.minCoreVersion),
      `非法 minCoreVersion：${launcher.minCoreVersion}`,
    )
    return launcher.minCoreVersion
  })
  check('launcher.json 可选字段类型', () => {
    if (launcher.description !== undefined) assert(typeof launcher.description === 'string', 'description 必须是字符串')
    if (launcher.homepage !== undefined) assert(/^https?:\/\//.test(String(launcher.homepage)), 'homepage 必须是 http(s) URL')
    if (launcher.gamesHint !== undefined) {
      assert(Array.isArray(launcher.gamesHint) && launcher.gamesHint.every((item) => typeof item === 'string'), 'gamesHint 必须是字符串数组')
    }
    return 'description/homepage/gamesHint 正常'
  })
  return launcher
}

/** 校验 package.json 与项目文件结构 */
async function checkPackageJson(launcher) {
  const pkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'))
  check('package.json 基本字段', () => {
    assert(pkg.name === 'dsh-launcher-minecraft', `name 错误：${pkg.name}`)
    assert(pkg.private === true, 'private 必须为 true')
    assert(pkg.type === 'module', 'type 必须是 module')
    assert(pkg.license === 'MIT', `license 必须是 MIT，实际 ${pkg.license}`)
    return `${pkg.name}@${pkg.version}`
  })
  check('package.json 版本与 launcher.json 一致', () => {
    assert(launcher && pkg.version === launcher.version, `package.json=${pkg.version} launcher.json=${launcher?.version}`)
    return pkg.version
  })
  check('package.json scripts 完整', () => {
    assert(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.includes('check-package'), '缺少 npm test（应含 check-package）')
    assert(typeof pkg.scripts?.['build:dist'] === 'string', '缺少 npm run build:dist')
    return 'test / build:dist'
  })
  check('必需文件存在', () => {
    const required = ['README.md', 'LICENSE', 'icon.svg', 'launcher.json', ...REQUIRED_LIB]
    const missing = required.filter((rel) => {
      const file = path.join(ROOT, rel)
      return !fs.existsSync(file) || fs.statSync(file).size === 0
    })
    assert(missing.length === 0, `缺少或为空：${missing.join(', ')}`)
    return `${required.length} 个文件`
  })
  check('README/LICENSE 内容长度合理', () => {
    const readme = fs.statSync(path.join(ROOT, 'README.md')).size
    const license = fs.statSync(path.join(ROOT, 'LICENSE')).size
    assert(readme > 2000, `README 过短：${readme}B`)
    assert(license > 200, `LICENSE 过短：${license}B`)
    return `README=${readme}B LICENSE=${license}B`
  })
  check('包内禁止 data/ node_modules/', () => {
    for (const dir of ['data', 'node_modules']) {
      assert(!fs.existsSync(path.join(ROOT, dir)), `不应存在 ${dir}/ 目录`)
    }
    return '无 data/、node_modules/'
  })
}

/** 扫描源码，禁止旧 DSH 插件注册逻辑与核心包 import */
async function checkForbiddenCode() {
  const files = []
  for (const dir of ['lib', 'scripts']) {
    for (const name of await fsp.readdir(path.join(ROOT, dir))) {
      // 跳过校验脚本自身（其中包含禁止字符串的定义）
      if (name === 'check-package.mjs') continue
      if (/\.(m?js)$/.test(name)) files.push(path.join(dir, name))
    }
  }
  const forbidden = [
    { label: "import '@local/dsh-launcher", re: /@local\/dsh-launcher/ },
    { label: 'globalThis.__dshLauncherRegistry', re: /__dshLauncherRegistry/ },
    { label: 'cordis.patch / plugin apply', re: /cordis\.patch|\.bundle\.patch/ },
    { label: 'core registry bridge', re: /sublauncher-[a-z-]+\.mjs|__dshLauncherBridge/ },
  ]
  check('无旧 DSH 插件注册逻辑/核心包依赖', () => {
    const hits = []
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      for (const rule of forbidden) {
        if (rule.re.test(text)) hits.push(`${rel} → ${rule.label}`)
      }
    }
    assert(hits.length === 0, hits.join('；'))
    return `${files.length} 个源码文件`
  })
}

/** 实际加载 entry，验证默认导出工厂返回合法 GameAdapter */
async function checkEntryFactory(launcher) {
  const entryUrl = pathToFileURL(path.join(ROOT, launcher.entry)).href
  let mod
  try {
    mod = await import(`${entryUrl}?check=${Date.now()}`)
  } catch (error) {
    bad('entry 可动态 import', `${error?.message ?? error}`)
    return
  }
  ok('entry 可动态 import（不依赖宿主）')
  check('entry 默认导出工厂函数', () => {
    assert(typeof mod.default === 'function', `default 期望 function，实际 ${typeof mod.default}`)
    return 'function'
  })
  check('工厂返回合法 GameAdapter', () => {
    const adapter = mod.default({ dl: null, paths: null, logger: console, registerGame: () => () => {} })
    assert(adapter && typeof adapter === 'object', '工厂未返回对象')
    assert(adapter.id === launcher.id, `adapter.id=${adapter.id} 与 launcher.json id=${launcher.id} 不一致`)
    assert(typeof adapter.label === 'string' && adapter.label.length > 0, 'adapter.label 缺失')
    assert(typeof adapter.versionLabel === 'string', 'adapter.versionLabel 缺失')
    for (const method of ['listVersions', 'install', 'launch']) {
      assert(typeof adapter[method] === 'function', `adapter.${method} 不是函数`)
    }
    return `${adapter.id} / ${adapter.label} / ${adapter.versionLabel}`
  })
}

/** 构建文件清单：包内允许的文件（与 build-dist 保持一致） */
function buildFileList() {
  const files = ['launcher.json', 'README.md', 'LICENSE', 'icon.svg']
  for (const name of fs.readdirSync(path.join(ROOT, 'lib')).sort()) {
    if (/\.(m?js)$/.test(name)) files.push(`lib/${name}`)
  }
  return files
}

async function run() {
  console.log('附属启动器包静态校验（scripts/check-package.mjs）')
  console.log(`项目目录：${ROOT}`)
  console.log('')
  const launcher = await checkLauncherJson()
  await checkPackageJson(launcher)
  await checkForbiddenCode()
  if (launcher) await checkEntryFactory(launcher)

  // 附：构建清单预览（供 build-dist 对齐）
  check('构建清单可生成', () => buildFileList().join(', '))

  console.log('')
  console.log(`结果：${checks} 项通过，${failures.length} 项失败`)
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exit(1)
  }
  console.log('结论：包结构符合 ARCHITECTURE-v4 §1。')
}

run().catch((error) => {
  console.error(`校验运行异常：${error?.stack ?? error}`)
  process.exit(1)
})
