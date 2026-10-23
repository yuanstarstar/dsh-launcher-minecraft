// lib/index.mjs —— 「我的世界启动器」附属启动器入口
//
// 附属启动器包格式（ARCHITECTURE-v4 §1）要求 entry 模块 `export default`：
//   函数 (helpers) => adapter | adapter[]
// 其中 helpers 由核心 game-store 提供：{ dl, paths, logger, registerGame }。
//
// 本包自带完整适配器实现（lib/adapter.js），不依赖任何 DSH 插件注册逻辑，
// 也不 import 核心包源码；工厂函数可被核心热加载多次调用，始终返回同一适配器实例。

import adapter from './adapter.js'

/**
 * 附属启动器工厂。
 * @param {object} [helpers] 核心注入的 helpers（{dl, paths, logger, registerGame}），
 *   本适配器自行创建下载器/子目录，故不强制使用。
 * @returns {import('./adapter.js').GameAdapter} GameAdapter 实例
 */
export default function createAdapter(helpers = {}) {
  void helpers
  return adapter
}

export { adapter }
