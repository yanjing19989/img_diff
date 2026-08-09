<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CompareViewport from './components/CompareViewport.vue'
import FileDetails from './components/FileDetails.vue'
import ImagePicker from './components/ImagePicker.vue'
import type {
  CompareMode,
  DiffSensitivity,
  DiffStats,
  EffectiveTheme,
  HighlightStyle,
  ImageAsset,
  ThemeMode,
} from './types'
import { formatPercentage } from './utils'

const allowedExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])
const modes: Array<{ id: CompareMode; label: string; icon: string }> = [
  { id: 'split', label: '分割', icon: '◫' },
  { id: 'fade', label: '淡化', icon: '◉' },
  { id: 'slider', label: '滑块', icon: '↔' },
  { id: 'highlight', label: '高亮', icon: '◇' },
  { id: 'subtract', label: '相减', icon: '−' },
  { id: 'details', label: '文件详解', icon: '≡' },
]

interface ServerImage {
  name: string
  url: string
}

interface ServerConfig {
  left: ServerImage
  right: ServerImage
  mode: CompareMode
}

const mode = ref<CompareMode>('split')
const left = shallowRef<ImageAsset | null>(null)
const right = shallowRef<ImageAsset | null>(null)
const leftLoading = ref(false)
const rightLoading = ref(false)
const leftError = ref('')
const rightError = ref('')
const workspaceError = ref('')
const fadeOpacity = ref(50)
const sliderPosition = ref(0.5)
const sensitivity = ref<DiffSensitivity>('standard')
const highlightStyle = ref<HighlightStyle>('context')
const stats = ref<DiffStats | null>(null)

let assetId = 0
let leftRequest = 0
let rightRequest = 0

const storedTheme = document.documentElement.dataset.themeMode
const themeMode = ref<ThemeMode>(
  storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system'
    ? storedTheme
    : 'system',
)
const systemTheme = ref<EffectiveTheme>(
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
)
const effectiveTheme = computed<EffectiveTheme>(() =>
  themeMode.value === 'system' ? systemTheme.value : themeMode.value,
)

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
const handleSystemTheme = (event: MediaQueryListEvent) => {
  systemTheme.value = event.matches ? 'dark' : 'light'
}
mediaQuery.addEventListener('change', handleSystemTheme)

watch(
  [themeMode, effectiveTheme],
  ([selected, effective]) => {
    document.documentElement.dataset.themeMode = selected
    document.documentElement.dataset.theme = effective
    try {
      localStorage.setItem('image-diff-theme', selected)
    } catch (_) {
      // Theme switching still works when storage is unavailable.
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', effective === 'dark' ? '#111417' : '#f4f6f8')
  },
  { immediate: true },
)

function extensionOf(name: string) {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
}

async function decodeFile(file: File): Promise<ImageAsset> {
  const extension = extensionOf(file.name)
  if (!allowedExtensions.has(extension)) {
    throw new Error('不支持该文件格式，请选择 PNG、JPEG、WebP、GIF 或 BMP')
  }
  if (!('createImageBitmap' in window)) {
    throw new Error('当前浏览器不支持本地图片解码')
  }

  const url = URL.createObjectURL(file)
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    if (!bitmap.width || !bitmap.height) {
      bitmap.close()
      throw new Error('图片没有有效尺寸')
    }
    return {
      id: ++assetId,
      file,
      url,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      extension,
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    if (error instanceof Error && error.message === '图片没有有效尺寸') throw error
    throw new Error('无法解码该图片，文件可能已损坏或浏览器不支持其编码')
  }
}

function disposeAsset(asset: ImageAsset | null) {
  if (!asset) return
  asset.bitmap.close()
  URL.revokeObjectURL(asset.url)
}

async function selectFile(side: 'left' | 'right', file: File) {
  const token = side === 'left' ? ++leftRequest : ++rightRequest
  const loading = side === 'left' ? leftLoading : rightLoading
  const error = side === 'left' ? leftError : rightError
  loading.value = true
  error.value = ''
  workspaceError.value = ''
  try {
    const asset = await decodeFile(file)
    const latest = side === 'left' ? leftRequest : rightRequest
    if (token !== latest) {
      disposeAsset(asset)
      return
    }
    const target = side === 'left' ? left : right
    disposeAsset(target.value)
    target.value = asset
    stats.value = null
  } catch (reason) {
    if (token === (side === 'left' ? leftRequest : rightRequest)) {
      error.value = reason instanceof Error ? reason.message : '图片读取失败'
    }
  } finally {
    if (token === (side === 'left' ? leftRequest : rightRequest)) loading.value = false
  }
}

function isCompareMode(value: unknown): value is CompareMode {
  return typeof value === 'string' && modes.some((item) => item.id === value)
}

function isServerImage(value: unknown): value is ServerImage {
  if (!value || typeof value !== 'object') return false
  const image = value as Partial<ServerImage>
  return typeof image.name === 'string' && typeof image.url === 'string'
}

async function fetchServerFile(image: ServerImage) {
  const response = await fetch(image.url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`无法读取 ${image.name}（HTTP ${response.status}）`)
  const blob = await response.blob()
  return new File([blob], image.name, { type: blob.type, lastModified: Date.now() })
}

onMounted(async () => {
  if (new URLSearchParams(window.location.search).get('autoload') !== '1') return

  try {
    const response = await fetch('/__image_diff__/config', { cache: 'no-store' })
    if (!response.ok) throw new Error(`无法读取服务配置（HTTP ${response.status}）`)
    const config = (await response.json()) as Partial<ServerConfig>
    if (!isServerImage(config.left) || !isServerImage(config.right) || !isCompareMode(config.mode)) {
      throw new Error('服务配置无效')
    }

    mode.value = config.mode
    const [leftFile, rightFile] = await Promise.all([
      fetchServerFile(config.left),
      fetchServerFile(config.right),
    ])
    await Promise.all([selectFile('left', leftFile), selectFile('right', rightFile)])
  } catch (reason) {
    workspaceError.value = reason instanceof Error ? reason.message : '无法从本地服务加载图片'
  }
})

function clearSide(side: 'left' | 'right') {
  if (side === 'left') {
    leftRequest += 1
    disposeAsset(left.value)
    left.value = null
    leftLoading.value = false
    leftError.value = ''
  } else {
    rightRequest += 1
    disposeAsset(right.value)
    right.value = null
    rightLoading.value = false
    rightError.value = ''
  }
  stats.value = null
  workspaceError.value = ''
}

function swapImages() {
  const previousLeft = left.value
  left.value = right.value
  right.value = previousLeft
  const previousLeftError = leftError.value
  leftError.value = rightError.value
  rightError.value = previousLeftError
  stats.value = null
  workspaceError.value = ''
}

function visualMode(value: CompareMode) {
  return value as Exclude<CompareMode, 'details'>
}

onBeforeUnmount(() => {
  mediaQuery.removeEventListener('change', handleSystemTheme)
  disposeAsset(left.value)
  disposeAsset(right.value)
})
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div class="brand-block">
        <span class="brand-mark" aria-hidden="true">◩</span>
        <div>
          <h1>图片对比</h1>
          <p>文件仅在当前浏览器中处理</p>
        </div>
      </div>

      <div class="theme-control" aria-label="主题模式">
        <button
          v-for="option in [
            { id: 'system', label: '跟随系统' },
            { id: 'light', label: '浅色' },
            { id: 'dark', label: '深色' },
          ] as const"
          :key="option.id"
          type="button"
          :class="{ active: themeMode === option.id }"
          @click="themeMode = option.id"
        >
          {{ option.label }}
        </button>
      </div>
    </header>

    <section class="file-row">
      <ImagePicker
        title="原始图片"
        :asset="left"
        :loading="leftLoading"
        :error="leftError"
        @select="selectFile('left', $event)"
        @clear="clearSide('left')"
      />

      <button
        class="swap-button"
        type="button"
        title="交换两张图片"
        :disabled="leftLoading || rightLoading || (!left && !right)"
        @click="swapImages"
      >
        ⇄
      </button>

      <ImagePicker
        title="修改图片"
        :asset="right"
        :loading="rightLoading"
        :error="rightError"
        @select="selectFile('right', $event)"
        @clear="clearSide('right')"
      />
    </section>

    <section v-if="left && right" class="workspace">
      <nav class="mode-tabs" aria-label="对比模式">
        <button
          v-for="item in modes"
          :key="item.id"
          type="button"
          :class="{ active: mode === item.id }"
          @click="mode = item.id"
        >
          <span aria-hidden="true">{{ item.icon }}</span>
          {{ item.label }}
        </button>
      </nav>

      <div v-if="mode === 'fade'" class="mode-options">
        <label for="fade-range">修改图片透明度</label>
        <input id="fade-range" v-model.number="fadeOpacity" type="range" min="0" max="100" />
        <output>{{ fadeOpacity }}%</output>
      </div>

      <div v-else-if="mode === 'highlight'" class="mode-options highlight-options">
        <label>
          灵敏度
          <select v-model="sensitivity">
            <option value="standard">标准</option>
            <option value="medium">中等</option>
            <option value="high">高</option>
            <option value="exact">精确</option>
          </select>
        </label>
        <div class="segmented-control" aria-label="高亮样式">
          <button
            type="button"
            :class="{ active: highlightStyle === 'context' }"
            @click="highlightStyle = 'context'"
          >
            灰度上下文
          </button>
          <button
            type="button"
            :class="{ active: highlightStyle === 'changes-only' }"
            @click="highlightStyle = 'changes-only'"
          >
            仅变化
          </button>
        </div>
        <div v-if="stats" class="diff-stats" title="像素差异统计">
          <strong>{{ stats.diffPixels.toLocaleString('zh-CN') }} px</strong>
          <span>{{ formatPercentage(stats.mismatchPercentage) }}% 发生变化</span>
        </div>
      </div>

      <p v-if="workspaceError" class="workspace-error" role="alert">{{ workspaceError }}</p>

      <FileDetails v-if="mode === 'details'" :left="left" :right="right" />
      <CompareViewport
        v-else
        :key="`${left.id}-${right.id}`"
        :left="left"
        :right="right"
        :mode="visualMode(mode)"
        :fade-opacity="fadeOpacity"
        :slider-position="sliderPosition"
        :sensitivity="sensitivity"
        :highlight-style="highlightStyle"
        @update:slider-position="sliderPosition = $event"
        @stats="stats = $event"
        @error="workspaceError = $event"
      />
    </section>

    <section v-else class="empty-state">
      <span aria-hidden="true">◫</span>
      <h2>选择两张图片开始对比</h2>
      <p>支持常用图片格式，所有计算都在本地完成。</p>
      <p v-if="workspaceError" class="workspace-error" role="alert">{{ workspaceError }}</p>
    </section>
  </main>
</template>
