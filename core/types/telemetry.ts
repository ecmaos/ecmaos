/**
 * Telemetry handling types and interfaces
 */

import type { Kernel } from './kernel.ts'

/**
 * Options for configuring telemetry handling
 */
export interface TelemetryOptions {
  /** Reference to kernel instance */
  kernel: Kernel
}

/**
 * Interface for telemetry handling functionality
 */
export interface Telemetry {
  /** Get the kernel instance */
  readonly kernel: Kernel

  /** Whether telemetry is currently active */
  readonly active: boolean
}
