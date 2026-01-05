import type { CronMap, IntervalMap, ITimerHandle } from '@ecmaos/types'
import { parseCronExpression } from 'cron-schedule'
import { TimerBasedCronScheduler as scheduler } from 'cron-schedule/schedulers/timer-based.js'

export class Intervals {
  private _intervals: IntervalMap = new Map()
  private _cronJobs: CronMap = new Map()

  get(name: string) {
    return this._intervals.get(name)
  }

  set(name: string, callback: () => void, interval: number) {
    const intervalId = setInterval(callback, interval)
    this._intervals.set(name, intervalId)
    return intervalId
  }

  clear(name: string) {
    const interval = this._intervals.get(name)
    if (interval) {
      clearInterval(interval)
      this._intervals.delete(name)
    }
  }

  getCron(name: string) {
    return this._cronJobs.get(name)
  }

  setCron(name: string, cronExpression: string, callback: () => void, opts?: { errorHandler?: (err: unknown) => unknown }): ITimerHandle {
    const cron = parseCronExpression(cronExpression)
    const handle = scheduler.setInterval(cron, callback, opts) as unknown as ITimerHandle
    this._cronJobs.set(name, handle)
    return handle
  }

  clearCron(name: string) {
    const handle = this._cronJobs.get(name)
    if (handle) {
      scheduler.clearTimeoutOrInterval(handle as unknown as Parameters<typeof scheduler.clearTimeoutOrInterval>[0])
      this._cronJobs.delete(name)
    }
  }

  listCrons(): string[] {
    return Array.from(this._cronJobs.keys())
  }
}
