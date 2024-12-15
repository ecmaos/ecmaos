import type { DeviceDriver } from '@zenfs/core'
import type { Kernel, KernelDeviceCLIOptions, KernelDeviceData } from '@ecmaos/types'

export const pkg = {
  name: 'webgl',
  version: '0.1.0',
  description: 'WebGL device driver'
}

interface WebGLDeviceData extends KernelDeviceData {
  context: WebGLRenderingContext
  info: {
    vendor: string
    renderer: string
    version: string
    extensions: string[]
  }
}

export async function cli(options: KernelDeviceCLIOptions) {
  const usage = `
Usage: /dev/webgl <command>

Commands:
  info      Show WebGL information
  test      Run a WebGL test that renders a rotating square
  --help    Show this help message
`

  if (!options.args.length || options.args[0] === '--help') {
    options.terminal.writeln(usage)
    return 0
  }

  try {
    switch (options.args[0]) {
      case 'test':
        await test(options.kernel)
        break
      case 'info':
        await showInfo(options.kernel)
        break
      default:
        options.terminal.writeln(`Unknown command: ${options.args[0]}`)
        options.terminal.writeln(usage)
        return 1
    }
  } catch (error) {
    options.terminal.writeln(`Error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  return 0
}

export async function getDrivers(kernel: Kernel): Promise<DeviceDriver<WebGLDeviceData>[]> {
  const drivers: DeviceDriver<WebGLDeviceData>[] = []

  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')

    if (context instanceof WebGLRenderingContext) {
      drivers.push({
        name: 'webgl',
        init: () => ({
          major: 1,
          minor: 0,
          data: {
            context,
            info: {
              vendor: context.getParameter(context.VENDOR),
              renderer: context.getParameter(context.RENDERER),
              version: context.getParameter(context.VERSION),
              extensions: context.getSupportedExtensions() || []
            }
          }
        }),
        read: () => 0,
        write: () => 0
      })
    }
  } catch (error) {
    kernel.log.error(`Failed to initialize WebGL device: ${error}`)
  }

  return drivers
}

async function showInfo(kernel: Kernel) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
  
  if (!context) {
    throw new Error('WebGL not available')
  }

  const info = {
    vendor: (context as WebGLRenderingContext).getParameter((context as WebGLRenderingContext).VENDOR),
    renderer: (context as WebGLRenderingContext).getParameter((context as WebGLRenderingContext).RENDERER), 
    version: (context as WebGLRenderingContext).getParameter((context as WebGLRenderingContext).VERSION),
    shadingLanguage: (context as WebGLRenderingContext).getParameter((context as WebGLRenderingContext).SHADING_LANGUAGE_VERSION),
    extensions: (context as WebGLRenderingContext).getSupportedExtensions() || []
  }

  kernel.terminal?.writeln('\nWebGL Information:')
  kernel.terminal?.writeln(`Vendor: ${info.vendor}`)
  kernel.terminal?.writeln(`Renderer: ${info.renderer}`)
  kernel.terminal?.writeln(`Version: ${info.version}`)
  kernel.terminal?.writeln(`Shading Language: ${info.shadingLanguage}`)
  kernel.terminal?.writeln('\nSupported Extensions:')
  info.extensions.forEach(ext => kernel.terminal?.writeln(`  ${ext}`))
}

async function test(kernel: Kernel) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
  
  if (!context) {
    throw new Error('WebGL not available')
  }

  // @ts-ignore
  if (kernel.terminal?.element) kernel.terminal.element.style.display = 'none'

  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'
  canvas.style.zIndex = '1000'
  document.body.appendChild(canvas)

  // Run the WebGL test (rotating square implementation)
  await runWebGLTest(context as WebGLRenderingContext)

  setTimeout(() => {
    // @ts-ignore
    if (kernel.terminal?.element) kernel.terminal.element.style.display = ''
    canvas.remove()
    kernel.terminal?.focus()
  }, 3000)
}

async function runWebGLTest(context: WebGLRenderingContext) {
  const canvas = context.canvas as HTMLCanvasElement
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'

  document.body.appendChild(canvas)
  setTimeout(() => document.body.removeChild(canvas), 3000)

  context.viewport(0, 0, canvas.width, canvas.height)
  context.clearColor(0.0, 1.0, 0.0, 1.0)
  context.clear(context.COLOR_BUFFER_BIT)

  const vertices = new Float32Array([10, 10, 100, 10, 10, 100, 100, 100])
  const vertexBuffer = context.createBuffer()
  context.bindBuffer(context.ARRAY_BUFFER, vertexBuffer)
  context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW)

  // Vertex shader source code
  const vertexShaderSource = `
    attribute vec2 a_position;
    uniform float u_rotation;
    void main() {
      float s = sin(u_rotation);
      float c = cos(u_rotation);
      mat2 rotationMatrix = mat2(c, -s, s, c);
      vec2 rotatedPosition = rotationMatrix * (a_position - vec2(55.0, 55.0)) + vec2(55.0, 55.0);
      gl_Position = vec4(rotatedPosition / vec2(55.0, 55.0) - vec2(1.0, 1.0), 0, 1);
    }
  `

  // Fragment shader source code
  const fragmentShaderSource = `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }
  `

  // Create and compile shaders
  const vertexShader = context.createShader(context.VERTEX_SHADER) as WebGLShader
  context.shaderSource(vertexShader, vertexShaderSource)
  context.compileShader(vertexShader)

  const fragmentShader = context.createShader(context.FRAGMENT_SHADER) as WebGLShader
  context.shaderSource(fragmentShader, fragmentShaderSource)
  context.compileShader(fragmentShader)

  // Create and link program
  const program = context.createProgram() as WebGLProgram
  context.attachShader(program, vertexShader)
  context.attachShader(program, fragmentShader)
  context.linkProgram(program)
  context.useProgram(program)

  // Get attribute and uniform locations
  const positionAttributeLocation = context.getAttribLocation(program, "a_position")
  const rotationUniformLocation = context.getUniformLocation(program, "u_rotation")

  // Enable the position attribute
  context.enableVertexAttribArray(positionAttributeLocation)
  context.vertexAttribPointer(positionAttributeLocation, 2, context.FLOAT, false, 0, 0)

  // Animation loop
  let rotation = 0
  const animate = () => {
    rotation += 0.05
    context.uniform1f(rotationUniformLocation, rotation)

    context.clear(context.COLOR_BUFFER_BIT)
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4)

    requestAnimationFrame(animate)
  }

  animate()
}
