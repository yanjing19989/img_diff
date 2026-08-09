export type CompareMode = 'split' | 'fade' | 'slider' | 'highlight' | 'subtract' | 'details'

export type DiffSensitivity = 'standard' | 'medium' | 'high' | 'exact'

export type HighlightStyle = 'context' | 'changes-only'

export type ThemeMode = 'system' | 'light' | 'dark'

export type EffectiveTheme = 'light' | 'dark'

export interface ImageAsset {
  id: number
  file: File
  url: string
  bitmap: ImageBitmap
  width: number
  height: number
  extension: string
}

export interface ViewportState {
  zoom: number
  panX: number
  panY: number
  dirty: boolean
}

export interface DiffStats {
  diffPixels: number
  totalPixels: number
  mismatchPercentage: number
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  changedWidth: number
  changedHeight: number
}

export interface WorkerInitMessage {
  type: 'init'
  comparisonId: number
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  changedWidth: number
  changedHeight: number
  left: ArrayBuffer
  right: ArrayBuffer
}

export interface WorkerComputeMessage {
  type: 'compute'
  comparisonId: number
  requestId: number
  output: 'highlight' | 'subtract'
  sensitivity: DiffSensitivity
  highlightStyle: HighlightStyle
}

export type WorkerRequest = WorkerInitMessage | WorkerComputeMessage

export interface WorkerReadyMessage {
  type: 'ready'
  comparisonId: number
}

export interface WorkerResultMessage {
  type: 'result'
  comparisonId: number
  requestId: number
  output: 'highlight' | 'subtract'
  pixels: ArrayBuffer
  stats?: DiffStats
}

export interface WorkerErrorMessage {
  type: 'error'
  comparisonId: number
  requestId?: number
  message: string
}

export type WorkerResponse = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage

