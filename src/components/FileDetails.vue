<script setup lang="ts">
import type { ImageAsset } from '../types'
import { formatBytes, formatDate } from '../utils'

const props = defineProps<{
  left: ImageAsset
  right: ImageAsset
}>()

function rows(asset: ImageAsset) {
  const ratio = asset.width / asset.height
  return [
    ['文件名', asset.file.name],
    ['扩展名', asset.extension.toUpperCase()],
    ['MIME 类型', asset.file.type || '未知'],
    ['文件大小', formatBytes(asset.file.size)],
    ['最后修改时间', formatDate(asset.file.lastModified)],
    ['宽度', `${asset.width.toLocaleString('zh-CN')} px`],
    ['高度', `${asset.height.toLocaleString('zh-CN')} px`],
    ['宽高比', `${ratio.toFixed(3)} : 1`],
    ['像素总量', `${((asset.width * asset.height) / 1_000_000).toFixed(2)} MP`],
  ]
}
</script>

<template>
  <div class="details-grid">
    <section v-for="(asset, index) in [props.left, props.right]" :key="asset.id" class="details-card">
      <header>
        <span class="side-badge">{{ index === 0 ? '原始图片' : '修改图片' }}</span>
        <strong :title="asset.file.name">{{ asset.file.name }}</strong>
      </header>
      <dl>
        <div v-for="row in rows(asset)" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd :title="row[1]">{{ row[1] }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

