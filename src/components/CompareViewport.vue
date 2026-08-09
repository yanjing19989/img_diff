<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import type {
  CompareMode,
  DiffSensitivity,
  DiffStats,
  HighlightStyle,
  ImageAsset,
  ViewportState,
  WorkerRequest,
  WorkerResponse,
} from '../types'

type VisualMode = Exclude<CompareMode, 'details'>

const props = defineProps<{
  left: ImageAsset
  right: ImageAsset
  mode: VisualMode
  fadeOpacity: number
  sliderPosition: number
  sensitivity: DiffSensitivity
  highlightStyle: HighlightStyle
}>()

const emit = defineEmits<{
  'update:sliderPosition': [value: number]
  stats: [value: DiffStats | null]
  error: [message: string]
}>()

const MAX_PIXELS = 16_000_000
const MAX_DIMENSION = 16_384

const area = ref<HTMLElement | null>(null)
const singleViewport = ref<HTMLElement | null>(null)
const singleStage = ref<HTMLElement | null>(null)
const singleLeft = ref<HTMLCanvasElement | null>(null)
const singleRight = ref<HTMLCanvasElement | null>(null)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const splitLeft = ref<HTMLCanvasElement | null>(null)
const splitRight = ref<HTMLCanvasElement | null>(null)

const areaSize = reactive({ width: 0, height: 0 })
const viewport: ViewportState = reactive({ zoom: 1, panX: 0, panY: 0, dirty: false })
const processing = ref(false)
const processingError = ref('')

const canvasWidth = computed(() => Math.max(props.left.width, props.right.width))
const canvasHeight = computed(() => Math.max(props.left.height, props.right.height))

const viewportWidth = computed(() =>
  props.mode === 'split' ? Math.max(1, (areaSize.width - 8) / 2) : Math.max(1, areaSize.width),
)

const fitScale = computed(() => {
  if (!areaSize.height || !canvasWidth.value || !canvasHeight.value) return 1
  return Math.min(viewportWidth.value / canvasWidth.value, areaSize.height / canvasHeight.value)
})

const actualScale = computed(() => fitScale.value * viewport.zoom)
const zoomPercent = computed(() => Math.round(actualScale.value * 100))
const stageStyle = computed(() => ({
  width: `${canvasWidth.value}px`,
  height: `${canvasHeight.value}px`,
  transform: `translate(calc(-50% + ${viewport.panX}px), calc(-50% + ${viewport.panY}px)) scale(${actualScale.value})`,
  '--control-scale': String(1 / Math.max(actualScale.value, 0.0001)),
}))

const rightLayerStyle = computed(() => {
  if (props.mode === 'fade') return { opacity: props.fadeOpacity / 100 }
  if (props.mode === 'slider') {
    return { clipPath: `inset(0 0 0 ${props.sliderPosition * 100}%)` }
  }
  return {}
})

let resizeObserver: ResizeObserver | null = null
let worker: Worker | null = null
let comparisonId = 0
let requestId = 0
let latestRequestId = 0
let workerReady = false

function canvasOffset(asset: ImageAsset) {
  return {
    x: Math.floor((canvasWidth.value - asset.width) / 2),
    y: Math.floor((canvasHeight.value - asset.height) / 2),
  }
}

function comparisonLimitError() {
  if (
    canvasWidth.value > MAX_DIMENSION ||
    canvasHeight.value > MAX_DIMENSION ||
    canvasWidth.value * canvasHeight.value > MAX_PIXELS
  ) {
    return `图片画布 ${canvasWidth.value} × ${canvasHeight.value} 超出本工具的安全处理上限（1600 万像素）`
  }
  return ''
}

function drawAsset(canvas: HTMLCanvasElement | null, asset: ImageAsset) {
  if (!canvas) return
  canvas.width = canvasWidth.value
  canvas.height = canvasHeight.value
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法创建 Canvas 2D 上下文')
  context.clearRect(0, 0, canvas.width, canvas.height)
  const offset = canvasOffset(asset)
  context.drawImage(asset.bitmap, offset.x, offset.y)
}

async function drawVisibleCanvases() {
  await nextTick()
  if (comparisonLimitError()) return
  try {
    if (props.mode === 'split') {
      drawAsset(splitLeft.value, props.left)
      drawAsset(splitRight.value, props.right)
    } else if (props.mode === 'fade' || props.mode === 'slider') {
      drawAsset(singleLeft.value, props.left)
      drawAsset(singleRight.value, props.right)
    }
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '图片绘制失败')
  }
}

function createNormalizedBuffer(asset: ImageAsset, canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器无法读取图片像素')
  context.clearRect(0, 0, canvas.width, canvas.height)
  const offset = canvasOffset(asset)
  context.drawImage(asset.bitmap, offset.x, offset.y)
  return context.getImageData(0, 0, canvas.width, canvas.height).data.buffer
}

function initializeWorker() {
  processingError.value = ''
  emit('error', '')
  emit('stats', null)
  workerReady = false
  comparisonId += 1
  requestId = 0
  latestRequestId = 0

  const limitError = comparisonLimitError()
  if (limitError) {
    const message = limitError
    processingError.value = message
    emit('error', message)
    return
  }

  try {
    if (!worker) {
      worker = new Worker(new URL('../diff.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = handleWorkerMessage
      worker.onerror = () => {
        processing.value = false
        processingError.value = '像素处理线程发生错误'
        emit('error', processingError.value)
      }
    }

    const temporaryCanvas = document.createElement('canvas')
    temporaryCanvas.width = canvasWidth.value
    temporaryCanvas.height = canvasHeight.value
    const left = createNormalizedBuffer(props.left, temporaryCanvas)
    const right = createNormalizedBuffer(props.right, temporaryCanvas)
    temporaryCanvas.width = 1
    temporaryCanvas.height = 1

    const message: WorkerRequest = {
      type: 'init',
      comparisonId,
      width: canvasWidth.value,
      height: canvasHeight.value,
      originalWidth: props.left.width,
      originalHeight: props.left.height,
      changedWidth: props.right.width,
      changedHeight: props.right.height,
      left,
      right,
    }
    worker.postMessage(message, [left, right])
  } catch (error) {
    processing.value = false
    processingError.value = error instanceof Error ? error.message : '无法准备图片像素'
    emit('error', processingError.value)
  }
}

function requestOutput() {
  const output =
    props.mode === 'highlight' ? 'highlight' : props.mode === 'subtract' ? 'subtract' : null
  if (!worker || !workerReady || !output) return
  requestId += 1
  latestRequestId = requestId
  processing.value = true
  processingError.value = ''
  if (props.mode !== 'highlight') emit('stats', null)

  const message: WorkerRequest = {
    type: 'compute',
    comparisonId,
    requestId,
    output,
    sensitivity: props.sensitivity,
    highlightStyle: props.highlightStyle,
  }
  worker.postMessage(message)
}

async function paintResult(pixels: ArrayBuffer) {
  await nextTick()
  const canvas = resultCanvas.value
  if (!canvas) return
  canvas.width = canvasWidth.value
  canvas.height = canvasHeight.value
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法显示计算结果')
  const imageData = new ImageData(new Uint8ClampedArray(pixels), canvas.width, canvas.height)
  context.putImageData(imageData, 0, 0)
}

function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
  const message = event.data
  if (message.comparisonId !== comparisonId) return
  if (message.type === 'ready') {
    workerReady = true
    requestOutput()
    return
  }
  if (message.type === 'error') {
    if (message.requestId && message.requestId !== latestRequestId) return
    processing.value = false
    processingError.value = message.message
    emit('error', message.message)
    return
  }
  if (message.requestId !== latestRequestId || message.output !== props.mode) return
  processing.value = false
  if (message.stats) emit('stats', message.stats)
  paintResult(message.pixels).catch((error) => {
    processingError.value = error instanceof Error ? error.message : '结果显示失败'
    emit('error', processingError.value)
  })
}

function fitToWindow() {
  viewport.zoom = 1
  viewport.panX = 0
  viewport.panY = 0
  viewport.dirty = false
}

function changeZoom(nextZoom: number, anchorX = 0, anchorY = 0) {
  const clamped = Math.min(20, Math.max(0.1, nextZoom))
  const oldScale = actualScale.value
  const nextScale = fitScale.value * clamped
  if (oldScale > 0) {
    const contentX = (anchorX - viewport.panX) / oldScale
    const contentY = (anchorY - viewport.panY) / oldScale
    viewport.panX = anchorX - contentX * nextScale
    viewport.panY = anchorY - contentY * nextScale
  }
  viewport.zoom = clamped
  viewport.dirty = true
}

function zoomIn() {
  changeZoom(viewport.zoom * 1.2)
}

function zoomOut() {
  changeZoom(viewport.zoom / 1.2)
}

function onWheel(event: WheelEvent) {
  if (!event.ctrlKey) return
  event.preventDefault()
  const element = event.currentTarget as HTMLElement
  const rect = element.getBoundingClientRect()
  const anchorX = event.clientX - rect.left - rect.width / 2
  const anchorY = event.clientY - rect.top - rect.height / 2
  const factor = Math.exp(-event.deltaY * 0.002)
  changeZoom(viewport.zoom * factor, anchorX, anchorY)
}

let panPointerId: number | null = null
let lastPointerX = 0
let lastPointerY = 0

function beginPan(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('.slider-divider')) return
  panPointerId = event.pointerId
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function movePan(event: PointerEvent) {
  if (panPointerId !== event.pointerId) return
  viewport.panX += event.clientX - lastPointerX
  viewport.panY += event.clientY - lastPointerY
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  viewport.dirty = true
}

function endPan(event: PointerEvent) {
  if (panPointerId !== event.pointerId) return
  panPointerId = null
  const element = event.currentTarget as HTMLElement
  if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
}

function updateSlider(event: PointerEvent) {
  const stage = singleStage.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const value = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  emit('update:sliderPosition', value)
}

function beginSlider(event: PointerEvent) {
  event.preventDefault()
  updateSlider(event)
  const move = (moveEvent: PointerEvent) => updateSlider(moveEvent)
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

watch(
  () => [props.left.id, props.right.id],
  () => {
    fitToWindow()
    drawVisibleCanvases()
    initializeWorker()
  },
)

watch(
  () => props.mode,
  () => {
    processing.value = false
    processingError.value = ''
    emit('error', '')
    const limitError = comparisonLimitError()
    if (limitError) {
      processingError.value = limitError
      emit('error', limitError)
      return
    }
    drawVisibleCanvases()
    requestOutput()
  },
)

watch(
  () => [props.sensitivity, props.highlightStyle],
  () => {
    if (props.mode === 'highlight') requestOutput()
  },
)

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    areaSize.width = entry.contentRect.width
    areaSize.height = entry.contentRect.height
    if (!viewport.dirty) {
      viewport.panX = 0
      viewport.panY = 0
      viewport.zoom = 1
    }
  })
  if (area.value) resizeObserver.observe(area.value)
  drawVisibleCanvases()
  initializeWorker()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  worker?.terminate()
})
</script>

<template>
  <section class="viewport-shell">
    <div ref="area" class="comparison-area" :class="{ 'is-processing': processing }">
      <template v-if="mode === 'split'">
        <div
          class="viewport split-pane"
          @wheel="onWheel"
          @pointerdown="beginPan"
          @pointermove="movePan"
          @pointerup="endPan"
          @pointercancel="endPan"
        >
          <span class="viewport-label">原始</span>
          <div class="canvas-stage" :style="stageStyle">
            <canvas ref="splitLeft" class="canvas-layer"></canvas>
          </div>
        </div>
        <div
          class="viewport split-pane"
          @wheel="onWheel"
          @pointerdown="beginPan"
          @pointermove="movePan"
          @pointerup="endPan"
          @pointercancel="endPan"
        >
          <span class="viewport-label">修改</span>
          <div class="canvas-stage" :style="stageStyle">
            <canvas ref="splitRight" class="canvas-layer"></canvas>
          </div>
        </div>
      </template>

      <div
        v-else
        ref="singleViewport"
        class="viewport single-pane"
        @wheel="onWheel"
        @pointerdown="beginPan"
        @pointermove="movePan"
        @pointerup="endPan"
        @pointercancel="endPan"
      >
        <div ref="singleStage" class="canvas-stage" :style="stageStyle">
          <template v-if="mode === 'fade' || mode === 'slider'">
            <canvas ref="singleLeft" class="canvas-layer"></canvas>
            <canvas ref="singleRight" class="canvas-layer" :style="rightLayerStyle"></canvas>
          </template>
          <canvas v-else ref="resultCanvas" class="canvas-layer"></canvas>

          <button
            v-if="mode === 'slider'"
            class="slider-divider"
            type="button"
            aria-label="拖动图片分隔线"
            :style="{ left: `${sliderPosition * 100}%` }"
            @pointerdown.stop="beginSlider"
          >
            <span>↔</span>
          </button>
        </div>

        <div v-if="processing" class="canvas-message" role="status">
          <span class="spinner"></span>
          正在计算像素差异
        </div>
        <div v-else-if="processingError" class="canvas-message error" role="alert">
          {{ processingError }}
        </div>
      </div>
    </div>

    <footer class="zoom-toolbar">
      <span class="interaction-hint">按住 Ctrl 滚轮缩放 · 拖拽平移</span>
      <div class="zoom-actions">
        <button type="button" title="缩小" @click="zoomOut">−</button>
        <span>{{ zoomPercent }}%</span>
        <button type="button" title="放大" @click="zoomIn">＋</button>
        <button type="button" @click="fitToWindow">适应窗口</button>
      </div>
    </footer>
  </section>
</template>
