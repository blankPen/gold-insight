import { syncAll } from './insight/sync/sync-all'
import config from './config'

let syncInProgress = false
let intervalHandle: ReturnType<typeof setInterval> | null = null

async function runSyncOnce(logger?: { info: (o: object, msg?: string) => void; warn: (o: object, msg?: string) => void; error: (o: object, msg?: string) => void }): Promise<void> {
  if (syncInProgress) {
    logger?.warn({}, '[InsightScheduler] skipped: previous sync still running')
    return
  }
  syncInProgress = true
  const t0 = Date.now()
  try {
    const result = await syncAll({
      mergeRoot: config.insightMergeRoot ? config.insightMergeRoot : undefined,
    })
    const elapsed = Date.now() - t0
    if (result.success) {
      logger?.info(
        { runId: result.runId, mergeRoot: result.mergeRoot, elapsedMs: elapsed },
        '[InsightScheduler] sync completed',
      )
    } else {
      logger?.warn(
        { error: result.error, elapsedMs: elapsed },
        '[InsightScheduler] sync failed',
      )
    }
  } catch (e) {
    logger?.error({ err: e }, '[InsightScheduler] sync threw')
  } finally {
    syncInProgress = false
  }
}

/**
 * Starts periodic insight merge sync (same as CLI --sync). No-op if disabled via config.
 */
export function startInsightScheduler(logger?: {
  info: (o: object, msg?: string) => void
  warn: (o: object, msg?: string) => void
  error: (o: object, msg?: string) => void
}): void {
  // if (!config.insightSyncEnabled) {
  //   logger?.info({}, '[InsightScheduler] disabled (INSIGHT_SYNC_ENABLED=false)')
  //   return
  // }

  const ms = config.insightSyncIntervalMs
  if (!Number.isFinite(ms) || ms < 60_000) {
    logger?.warn({ ms }, '[InsightScheduler] invalid INSIGHT_SYNC_INTERVAL_MS, using 3h')
  }
  const intervalMs = Number.isFinite(ms) && ms >= 60_000 ? ms : 3 * 60 * 60 * 1000

  void runSyncOnce(logger)

  intervalHandle = setInterval(() => {
    void runSyncOnce(logger)
  }, intervalMs)

  logger?.info({ intervalMs }, '[InsightScheduler] started')
}

export function stopInsightScheduler(): void {
  if (intervalHandle != null) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
