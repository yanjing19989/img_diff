/// <reference lib="webworker" />

import type {
  DiffSensitivity,
  DiffStats,
  WorkerRequest,
  WorkerResponse,
} from './types'

const thresholds: Record<DiffSensitivity, number> = {
  standard: 0.1,
  medium: 0.05,
  high: 0.015,
  exact: 0,
}

let comparisonId = -1
let width = 0
let height = 0
let originalWidth = 0
let originalHeight = 0
let changedWidth = 0
let changedHeight = 0
let leftPixels = new Uint8ClampedArray()
let rightPixels = new Uint8ClampedArray()

const workerScope = self as DedicatedWorkerGlobalScope

function composite(channel: number, alpha: number) {
  return 255 + (channel - 255) * (alpha / 255)
}

function pixelDelta(index: number) {
  const leftAlpha = leftPixels[index + 3]
  const rightAlpha = rightPixels[index + 3]
  const dr = composite(leftPixels[index], leftAlpha) - composite(rightPixels[index], rightAlpha)
  const dg = composite(leftPixels[index + 1], leftAlpha) - composite(rightPixels[index + 1], rightAlpha)
  const db = composite(leftPixels[index + 2], leftAlpha) - composite(rightPixels[index + 2], rightAlpha)
  return Math.sqrt(0.5053 * dr * dr + 0.299 * dg * dg + 0.1957 * db * db) / 255
}

function luminance(pixels: Uint8ClampedArray, index: number) {
  const alpha = pixels[index + 3]
  const red = composite(pixels[index], alpha)
  const green = composite(pixels[index + 1], alpha)
  const blue = composite(pixels[index + 2], alpha)
  return 0.299 * red + 0.587 * green + 0.114 * blue
}

function computeHighlight(sensitivity: DiffSensitivity, changesOnly: boolean) {
  const result = new Uint8ClampedArray(width * height * 4)
  const threshold = thresholds[sensitivity]
  let diffPixels = 0

  for (let index = 0; index < result.length; index += 4) {
    const changed = pixelDelta(index) > threshold
    if (changed) {
      diffPixels += 1
      const brighter = luminance(rightPixels, index) >= luminance(leftPixels, index)
      result[index] = brighter ? 18 : 229
      result[index + 1] = brighter ? 165 : 72
      result[index + 2] = brighter ? 148 : 62
      result[index + 3] = 255
      continue
    }

    if (changesOnly) {
      result[index] = 255
      result[index + 1] = 255
      result[index + 2] = 255
      result[index + 3] = 255
      continue
    }

    const alpha = leftPixels[index + 3]
    if (alpha === 0 && rightPixels[index + 3] === 0) {
      result[index + 3] = 0
      continue
    }
    const gray = Math.round(luminance(leftPixels, index))
    result[index] = gray
    result[index + 1] = gray
    result[index + 2] = gray
    result[index + 3] = Math.max(96, alpha)
  }

  const totalPixels = width * height
  const stats: DiffStats = {
    diffPixels,
    totalPixels,
    mismatchPercentage: totalPixels ? (diffPixels / totalPixels) * 100 : 0,
    width,
    height,
    originalWidth,
    originalHeight,
    changedWidth,
    changedHeight,
  }
  return { result, stats }
}

function computeSubtract() {
  const result = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < result.length; index += 4) {
    const leftAlpha = leftPixels[index + 3] / 255
    const rightAlpha = rightPixels[index + 3] / 255
    const alphaDelta = Math.abs(leftPixels[index + 3] - rightPixels[index + 3])
    result[index] = Math.max(
      alphaDelta,
      Math.abs(leftPixels[index] * leftAlpha - rightPixels[index] * rightAlpha),
    )
    result[index + 1] = Math.max(
      alphaDelta,
      Math.abs(leftPixels[index + 1] * leftAlpha - rightPixels[index + 1] * rightAlpha),
    )
    result[index + 2] = Math.max(
      alphaDelta,
      Math.abs(leftPixels[index + 2] * leftAlpha - rightPixels[index + 2] * rightAlpha),
    )
    result[index + 3] = 255
  }
  return result
}

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  workerScope.postMessage(message, transfer)
}

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  try {
    if (message.type === 'init') {
      comparisonId = message.comparisonId
      width = message.width
      height = message.height
      originalWidth = message.originalWidth
      originalHeight = message.originalHeight
      changedWidth = message.changedWidth
      changedHeight = message.changedHeight
      leftPixels = new Uint8ClampedArray(message.left)
      rightPixels = new Uint8ClampedArray(message.right)
      post({ type: 'ready', comparisonId })
      return
    }

    if (message.comparisonId !== comparisonId) return

    if (message.output === 'subtract') {
      const pixels = computeSubtract()
      post(
        {
          type: 'result',
          comparisonId,
          requestId: message.requestId,
          output: 'subtract',
          pixels: pixels.buffer,
        },
        [pixels.buffer],
      )
      return
    }

    const { result, stats } = computeHighlight(
      message.sensitivity,
      message.highlightStyle === 'changes-only',
    )
    post(
      {
        type: 'result',
        comparisonId,
        requestId: message.requestId,
        output: 'highlight',
        pixels: result.buffer,
        stats,
      },
      [result.buffer],
    )
  } catch (error) {
    post({
      type: 'error',
      comparisonId,
      requestId: message.type === 'compute' ? message.requestId : undefined,
      message: error instanceof Error ? error.message : '像素计算失败',
    })
  }
}

export {}
