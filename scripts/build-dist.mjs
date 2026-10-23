// scripts/build-dist.mjs —— 构建附属启动器发行包
//
// 产出（ARCHITECTURE-v4 §1）：
//   dist/minecraft-launcher-1.0.0/     解压开箱目录（launcher.json 在根）
//   dist/minecraft-launcher-1.0.0.zip  zip 包，根目录直接含 launcher.json（无外层文件夹）
//
// 约束：只用 Node 内置模块；不 import 核心包；zip 自行实现（deflateRaw + crc32 + 中央目录），
// 并在构建后回读 zip 中央目录做一次自校验。
//
// 运行：node scripts/build-dist.mjs
// 退出码：0 成功；1 失败。

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)

function log(line) {
  process.stdout.write(`${line}\n`)
}

function fail(message) {
  log(`FAIL ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 文件清单（与 check-package.mjs 对齐；zip 根目录直接是这些文件）
// ---------------------------------------------------------------------------

function collectFiles() {
  const files = ['launcher.json', 'README.md', 'LICENSE', 'icon.svg']
  for (const name of fs.readdirSync(path.join(ROOT, 'lib')).sort()) {
    if (/\.(m?js)$/.test(name)) files.push(`lib/${name}`)
  }
  for (const required of ['launcher.json', 'lib/index.mjs']) {
    if (!files.includes(required)) throw new Error(`构建清单缺少 ${required}`)
  }
  return files
}

// ---------------------------------------------------------------------------
// 极简 zip 写入器（deflate；文件名 UTF-8；不含目录条目）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function buildZip(entries) {
  const { time, date } = dosDateTime()
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const raw = entry.data
    const deflated = zlib.deflateRawSync(raw, { level: 9 })
    const crc = crc32(raw)
    const flags = 0x0800 // UTF-8 文件名

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + deflated.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, ...centralParts, eocd])
}

// ---------------------------------------------------------------------------
// zip 回读校验：中央目录 + 必备文件 + 禁止目录
// ---------------------------------------------------------------------------

function verifyZip(zipPath) {
  const buffer = fs.readFileSync(zipPath)
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('zip 魔数错误（不是本地文件头）')
  let eocdOffset = -1
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error('找不到 zip EOCD')
  const count = buffer.readUInt16LE(eocdOffset + 10)
  const centralSize = buffer.readUInt32LE(eocdOffset + 12)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (centralOffset + centralSize > buffer.length) throw new Error('中央目录越界')

  const entries = new Map()
  let cursor = centralOffset
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`中央目录条目 ${i} 签名错误`)
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compSize = buffer.readUInt32LE(cursor + 20)
    const rawSize = buffer.readUInt32LE(cursor + 24)
    const nameLen = buffer.readUInt16LE(cursor + 28)
    const extraLen = buffer.readUInt16LE(cursor + 30)
    const commentLen = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLen)
    if (!(flags & 0x0800)) throw new Error(`条目 ${name} 未设置 UTF-8 标志`)
    const localNameLen = buffer.readUInt16LE(localOffset + 26)
    const localExtraLen = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const compressed = buffer.subarray(dataStart, dataStart + compSize)
    const data = method === 8 ? zlib.inflateRawSync(compressed) : compressed
    if (data.length !== rawSize) throw new Error(`条目 ${name} 解压长度不一致`)
    entries.set(name, data)
    cursor += 46 + nameLen + extraLen + commentLen
  }
  if (entries.size !== count) throw new Error('中央目录条目数不一致')

  const required = ['launcher.json', 'lib/index.mjs', 'README.md', 'LICENSE', 'icon.svg']
  const missing = required.filter((name) => !entries.has(name))
  if (missing.length > 0) throw new Error(`zip 根缺少：${missing.join(', ')}`)
  for (const name of entries.keys()) {
    if (name.startsWith('data/') || name.startsWith('test/') || name.startsWith('node_modules/') || name.includes('..')) {
      throw new Error(`zip 含禁止路径：${name}`)
    }
    if (!name.includes('/') && name !== 'launcher.json' && !['README.md', 'LICENSE', 'icon.svg'].includes(name)) {
      throw new Error(`zip 根存在无关文件：${name}`)
    }
  }
  const launcher = JSON.parse(entries.get('launcher.json').toString('utf8'))
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  if (launcher.schemaVersion !== 1) throw new Error('launcher.json schemaVersion 不是 1')
  if (launcher.version !== pkg.version) throw new Error('launcher.json 与 package.json 版本不一致')
  return { count, entries: [...entries.keys()], launcher }
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

async function run() {
  log('构建 Minecraft 附属启动器发行包（scripts/build-dist.mjs）')

  // 1) 先跑静态校验，避免把坏包发出去
  log('')
  log('步骤 1/4：运行 check-package 静态校验')
  const check = spawnSync(process.execPath, [path.join(HERE, 'check-package.mjs')], { stdio: 'inherit' })
  if (check.status !== 0) fail('静态校验未通过，终止构建')

  // 2) 收集文件并读取内容
  log('')
  log('步骤 2/4：收集打包文件')
  const files = collectFiles()
  const entries = []
  for (const rel of files) {
    const data = await fsp.readFile(path.join(ROOT, rel))
    entries.push({ name: rel, data })
    log(`  + ${rel}（${data.length}B）`)
  }

  // 3) 生成 dist 目录与 zip
  const launcher = JSON.parse(await fsp.readFile(path.join(ROOT, 'launcher.json'), 'utf8'))
  const distName = `minecraft-launcher-${launcher.version}`
  const distDir = path.join(ROOT, 'dist', distName)
  const zipPath = path.join(ROOT, 'dist', `${distName}.zip`)
  log('')
  log(`步骤 3/4：写入 ${path.relative(ROOT, distDir)} 与 ${path.relative(ROOT, zipPath)}`)
  await fsp.rm(distDir, { recursive: true, force: true })
  await fsp.mkdir(distDir, { recursive: true })
  for (const rel of files) {
    const dest = path.join(distDir, rel)
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    await fsp.copyFile(path.join(ROOT, rel), dest)
  }
  const zipBuffer = buildZip(entries)
  await fsp.mkdir(path.dirname(zipPath), { recursive: true })
  await fsp.writeFile(zipPath, zipBuffer)

  // 4) 回读校验
  log('')
  log('步骤 4/4：回读 zip 中央目录校验')
  const verified = verifyZip(zipPath)
  log(`  zip 根文件：${verified.entries.join(', ')}`)
  log(`  zip 条目数：${verified.count}`)
  const size = zipBuffer.length
  log('')
  log(`构建成功：${zipPath}`)
  log(`zip 大小：${size}B（${(size / 1024 / 1024).toFixed(2)}MB）`)
  log(`解压目录：${distDir}`)
  log(`安装包：${distName}.zip（zip 根直接含 launcher.json）`)
}

run().catch((error) => {
  console.error(`构建失败：${error?.stack ?? error}`)
  process.exit(1)
})
