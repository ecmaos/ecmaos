import type { Terminal, Timer } from '@ecmaos/types'

interface Toaster {
  x: number
  y: number
  vx: number
  vy: number
  frame: number
  frameCounter: number
  baseY: number
}

interface Toast {
  x: number
  y: number
  vy: number
  vx: number
}

export default async function ({ terminal }: { terminal: Terminal }) {
  if (document.getElementById('screensaver')) return false

  const canvas = document.createElement('canvas')
  canvas.id = 'screensaver'
  canvas.width = globalThis.innerWidth
  canvas.height = globalThis.innerHeight
  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'
  canvas.style.zIndex = Number.MAX_SAFE_INTEGER.toString()

  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const spritesheet = new Image()
  spritesheet.src = '/toasters.png'

  await new Promise<void>((resolve, reject) => {
    spritesheet.onload = () => resolve()
    spritesheet.onerror = () => reject(new Error('Failed to load toasters spritesheet'))
  })

  if (spritesheet.width === 0 || spritesheet.height === 0) return false

  const toasterWidth = 65
  const toasterHeight = 58
  const toastWidth = 65
  const toastHeight = 39
  const toasterSpacing = spritesheet.width / 5

  const processSprite = (sx: number, sy: number, width: number, height: number): HTMLCanvasElement => {
    const spriteCanvas = document.createElement('canvas')
    spriteCanvas.width = width
    spriteCanvas.height = height
    const spriteCtx = spriteCanvas.getContext('2d')
    if (!spriteCtx) return spriteCanvas

    spriteCtx.drawImage(spritesheet, sx, sy, width, height, 0, 0, width, height)

    const imageData = spriteCtx.getImageData(0, 0, width, height)
    const data = imageData.data

    // Make the sprite transparent
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 0x11 && data[i + 1] === 0x11 && data[i + 2] === 0x11) {
        data[i + 3] = 0
      }
    }

    spriteCtx.putImageData(imageData, 0, 0)
    return spriteCanvas
  }

  const toasterSprites: HTMLCanvasElement[] = []
  for (let i = 0; i < 5; i++) {
    toasterSprites.push(processSprite(i * toasterSpacing, 0, toasterWidth, toasterHeight))
  }
  const toastSprite = processSprite(0, toasterHeight, toastWidth, toastHeight)

  const toasters: Toaster[] = []
  const toasts: Toast[] = []

  const maxToasters = 5
  const maxToasts = 20

  const createToaster = (): Toaster => {
    const baseY = Math.random() * (canvas.height - toasterHeight * 2) + toasterHeight
    return {
      x: canvas.width + toasterWidth,
      y: baseY,
      vx: -(2 + Math.random() * 2),
      vy: Math.sin(Math.random() * Math.PI * 2) * 0.5,
      frame: 0,
      frameCounter: 0,
      baseY
    }
  }

  for (let i = 0; i < maxToasters; i++) {
    const toaster = createToaster()
    toaster.x = canvas.width + (i * toasterWidth * 3)
    toasters.push(toaster)
  }

  const animate = () => {
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    for (let i = toasters.length - 1; i >= 0; i--) {
      const toaster = toasters[i]
      if (!toaster) continue

      toaster.frameCounter++
      if (toaster.frameCounter >= 5) {
        toaster.frameCounter = 0
        toaster.frame = (toaster.frame + 1) % 5
      }

      toaster.y = toaster.baseY + Math.sin(toaster.x * 0.01) * 20
      toaster.x += toaster.vx

      if (toaster.x < -toasterWidth) {
        toasters[i] = createToaster()
        toasters[i]!.x = canvas.width + toasterWidth
      }

      const sprite = toasterSprites[toaster.frame]
      if (sprite) ctx.drawImage(sprite, toaster.x, toaster.y)

      if (Math.random() < 0.01 && toasts.length < maxToasts) {
        toasts.push({
          x: toaster.x + toasterWidth / 2,
          y: toaster.y + toasterHeight,
          vy: 1 + Math.random() * 2,
          vx: (Math.random() - 0.5) * 0.5
        })
      }
    }

    for (let i = toasts.length - 1; i >= 0; i--) {
      const toast = toasts[i]
      if (!toast) continue
      toast.x += toast.vx
      toast.y += toast.vy

      if (toast.y > canvas.height) {
        toasts.splice(i, 1)
        continue
      }

      ctx.drawImage(
        toastSprite,
        toast.x - toastWidth / 2,
        toast.y
      )
    }
  }

  terminal.unlisten()
  const interval = setInterval(animate, 33)
  document.addEventListener('click', () => exit(interval, canvas, terminal))
  document.addEventListener('mousemove', () => exit(interval, canvas, terminal))
  document.addEventListener('keydown', () => exit(interval, canvas, terminal))
}

export async function exit (interval: Timer, canvas: HTMLCanvasElement, terminal: Terminal) {
  clearInterval(interval)
  canvas.remove()
  terminal.listen()
}
