import type { Kernel, TelemetryOptions } from '@ecmaos/types'
import { trace } from '@opentelemetry/api'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ZoneContextManager } from '@opentelemetry/context-zone'
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

export class Telemetry {
  private _kernel: Kernel
  private _provider?: WebTracerProvider
  private _active: boolean = false

  get kernel() { return this._kernel }
  get active() { return this._active }

  constructor(options: TelemetryOptions) {
    this._kernel = options.kernel
    const endpoint = import.meta.env.ECMAOS_OPENTELEMETRY_ENDPOINT

    if (endpoint) {
      try {
        this._initialize(endpoint)
      } catch (error) {
        this._kernel.log.error(`Failed to initialize OpenTelemetry: ${error}`)
      }
    }
  }

  private _initialize(endpoint: string) {
    const exporter = new OTLPTraceExporter({
      url: endpoint,
      headers: {}
    })

    const useSimpleProcessor = import.meta.env.ECMAOS_OPENTELEMETRY_SIMPLE_PROCESSOR === 'true'
    const spanProcessor = useSimpleProcessor
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter, {
          scheduledDelayMillis: 100,
          maxQueueSize: 2048,
          maxExportBatchSize: 512
        })

    this._provider = new WebTracerProvider({
      spanProcessors: [spanProcessor]
    })

    this._provider.register({
      contextManager: new ZoneContextManager()
    })

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation()
      ]
    })

    this._active = true
    this._kernel.log.info(`OpenTelemetry initialized with endpoint: ${endpoint}`)
  }

  getTracer(name: string, version?: string) {
    if (!this._active || !this._provider) {
      return trace.getTracer('noop')
    }
    return trace.getTracer(name, version)
  }
}
