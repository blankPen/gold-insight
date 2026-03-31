/**
 * OptiL 期权数据分析计算模块
 *
 * 实现拆分为 compute/ 子文件，由此聚合导出（与原 `compute.ts` 对外 API 一致）。
 *
 * 与后端 Python 对齐关系见各子模块注释；Usage:
 *   import { computeChartData, discoverContracts, calculateIV } from './compute'
 */

export * from './types'
export * from './helpers'
export * from './excel-parse'
export * from './option-metrics'
export * from './black-scholes'
export * from './strike-structure'
export * from './sync-context'
export * from './cme-analysis'
export * from './chart'
export * from './compute-all'
