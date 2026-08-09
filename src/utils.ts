export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: index === 0 ? 0 : 2 })} ${units[index]}`
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
}

export function formatPercentage(value: number) {
  if (value === 0) return '0'
  if (value < 0.01) return value.toFixed(4)
  if (value < 1) return value.toFixed(2)
  return value.toFixed(1)
}

