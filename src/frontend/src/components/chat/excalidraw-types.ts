export type ExcalidrawElement = {
  type: string
  id?: string
  x?: number
  y?: number
  width?: number
  height?: number
  points?: [number, number][]
  text?: string
  label?: { text?: string; fontSize?: number }
  fontSize?: number
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  endArrowhead?: string | null
}

export type ExcalidrawView = {
  ok: true
  type: "excalidraw_view"
  title?: string
  checkpoint_id?: string
  elements: ExcalidrawElement[]
  element_count?: number
  source?: string
}
