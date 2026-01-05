/**
 * Interval management types and interfaces
 */

/**
 * Type for mapping interval names to their timer IDs
 */
export type IntervalMap = Map<string, ReturnType<typeof setInterval>>

/**
 * Timer handle interface matching cron-schedule's ITimerHandle
 * This matches the return type of TimerBasedCronScheduler.setInterval
 */
export interface ITimerHandle {
  clear(): void
}

/**
 * Type for mapping cron job names to their timer handles
 */
export type CronMap = Map<string, ITimerHandle>

/**
 * Interface for interval management functionality
 */
export interface Intervals {
  /**
   * Get an interval by name
   * @param name - Name of the interval
   */
  get(name: string): ReturnType<typeof setInterval> | undefined

  /**
   * Set a new interval
   * @param name - Name for the interval
   * @param callback - Function to execute
   * @param interval - Time in milliseconds between executions
   */
  set(name: string, callback: () => void, interval: number): ReturnType<typeof setInterval>

  /**
   * Clear an interval by name
   * @param name - Name of the interval to clear
   */
  clear(name: string): void

  /**
   * Get a cron job by name
   * @param name - Name of the cron job
   */
  getCron(name: string): ITimerHandle | undefined

  /**
   * Set a new cron job
   * @param name - Name for the cron job
   * @param cronExpression - Cron expression (e.g., "0 5 * * *" for every 5 minutes past the hour)
   * @param callback - Function to execute
   * @param opts - Optional error handler
   */
  setCron(name: string, cronExpression: string, callback: () => void, opts?: { errorHandler?: (err: unknown) => unknown }): ITimerHandle

  /**
   * Clear a cron job by name
   * @param name - Name of the cron job to clear
   */
  clearCron(name: string): void

  /**
   * List all active cron job names
   */
  listCrons(): string[]
} 