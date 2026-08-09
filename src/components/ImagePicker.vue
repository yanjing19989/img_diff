<script setup lang="ts">
import { ref } from 'vue'
import type { ImageAsset } from '../types'
import { formatBytes } from '../utils'

defineProps<{
  title: string
  asset: ImageAsset | null
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  select: [file: File]
  clear: []
}>()

const input = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

function openPicker() {
  if (input.value) {
    input.value.value = ''
    input.value.click()
  }
}

function selectFromInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) emit('select', file)
}

function handleDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) emit('select', file)
}
</script>

<template>
  <section
    class="image-picker"
    :class="{ 'is-dragging': dragging, 'has-file': asset }"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="handleDrop"
  >
    <input
      ref="input"
      class="sr-only"
      type="file"
      accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,image/png,image/jpeg,image/webp,image/gif,image/bmp"
      @change="selectFromInput"
    />

    <div class="picker-heading">
      <span class="side-badge">{{ title }}</span>
      <button v-if="asset" class="icon-button" type="button" title="清空图片" @click="emit('clear')">
        ×
      </button>
    </div>

    <button class="picker-body" type="button" :disabled="loading" @click="openPicker">
      <template v-if="loading">
        <span class="spinner" aria-hidden="true"></span>
        <strong>正在读取图片</strong>
      </template>
      <template v-else-if="asset">
        <span class="file-icon" aria-hidden="true">▧</span>
        <span class="file-copy">
          <strong :title="asset.file.name">{{ asset.file.name }}</strong>
          <small>{{ asset.width }} × {{ asset.height }} · {{ formatBytes(asset.file.size) }}</small>
        </span>
        <span class="replace-label">替换</span>
      </template>
      <template v-else>
        <span class="upload-icon" aria-hidden="true">＋</span>
        <span class="file-copy">
          <strong>选择或拖入图片</strong>
          <small>PNG、JPEG、WebP、GIF、BMP</small>
        </span>
      </template>
    </button>

    <p v-if="error" class="picker-error" role="alert">{{ error }}</p>
  </section>
</template>

