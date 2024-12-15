/// <reference types="@webgpu/types" />

declare global {
  interface Navigator {
    readonly gpu: GPU;
  }
}

import type { DeviceDriver } from '@zenfs/core'
import type { Kernel, KernelDeviceCLIOptions, KernelDeviceData } from '@ecmaos/types'

export const pkg = {
  name: 'gpu',
  version: '0.1.0',
  description: 'WebGPU device driver'
}

export async function cli(options: KernelDeviceCLIOptions) {
  options.kernel.log.debug(`${pkg.name} CLI`, options.args)

  const usage = `
Usage: gpu <command>

Commands:
  test    Run a WebGPU test that renders a triangle
  --help  Show this help message

Enable WebGPU hardware acceleration at chrome://flags/#enable-webgpu-developer-features
Launch chrome using: google-chrome --enable-unsafe-webgpu --enable-features=Vulkan,UseSkiaRenderer
`

  if (!options.args.length || options.args[0] === '--help') {
    options.terminal.writeln(usage)
    return 0
  }

  switch (options.args[0]) {
    case 'test':
      await test(options.kernel)
      break
    default:
      options.terminal.writeln(`Unknown command: ${options.args[0]}`)
      options.terminal.writeln(usage)
      return 1
  }

  return 0
}

export async function getDrivers(kernel: Kernel): Promise<DeviceDriver<KernelDeviceData>[]> {
  const drivers: DeviceDriver<KernelDeviceData>[] = []

  if ('gpu' in navigator) {
    const adapter = await navigator.gpu.requestAdapter()
    if (adapter) {
      const device = await adapter.requestDevice()

      drivers.push({
        name: 'gpu',
        init: () => ({
          major: adapter.info?.vendor === 'nvidia' ? 195 : 10,
          minor: 0,
          data: { 
            adapter,
            device,
            kernelId: kernel.id,
            features: Array.from(adapter.features),
            limits: Object.fromEntries(
              Object.entries(adapter.limits).map(([k,v]) => [k, String(v)])
            )
          }
        }),
        read: () => 0,
        write: () => 0
      })
    }
  }

  return drivers
}

async function test(kernel: Kernel) {
  if (!('gpu' in navigator)) throw new Error('WebGPU not available')

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No adapter found')
  const device = await adapter.requestDevice()
  if (!device) throw new Error('No device found')

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('No context found')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format })

  const vertexShaderCode = `
    @vertex
    fn vertex_main(@builtin(vertex_index) VertexIndex : u32) -> @builtin(position) vec4<f32> {
      var pos = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 0.5),
        vec2<f32>(-0.5, -0.5),
        vec2<f32>(0.5, -0.5)
      );
      return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
    }
  `

  const pipeline = device.createRenderPipeline({
    vertex: {
      module: device.createShaderModule({ code: vertexShaderCode }),
      entryPoint: 'vertex_main'
    },
    fragment: {
      module: device.createShaderModule({
        code: `
          @fragment
          fn fragment_main() -> @location(0) vec4<f32> {
            return vec4<f32>(1.0, 0.0, 0.0, 1.0);
          }
        `
      }),
      entryPoint: 'fragment_main',
      targets: [{ format }]
    },
    primitive: {
      topology: 'triangle-list'
    },
    layout: 'auto'
  })

  const vertexBuffer = device.createBuffer({
    size: 3 * 2 * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  })
  const vertexArray = new Float32Array([
    0.0, 0.5,
    -0.5, -0.5,
    0.5, -0.5
  ])

  device.queue.writeBuffer(vertexBuffer, 0, vertexArray)

  const commandEncoder = device.createCommandEncoder()
  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: 'clear',
      storeOp: 'store'
    }]
  })

  pass.setPipeline(pipeline)
  pass.setVertexBuffer(0, vertexBuffer)
  pass.draw(3, 1, 0, 0)
  pass.end()

  device.queue.submit([commandEncoder.finish()])

  // @ts-ignore
  if (kernel.terminal?.element) kernel.terminal.element.style.display = 'none'

  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'
  canvas.style.zIndex = '1000'
  document.body.appendChild(canvas)

  setTimeout(() => {
    // @ts-ignore
    if (kernel.terminal?.element) kernel.terminal.element.style.display = ''
    canvas.remove()
    kernel.terminal.focus()
  }, 2000)
}
