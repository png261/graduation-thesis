"use client"

import { useEffect, useMemo, useState } from "react"
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import "@excalidraw/excalidraw/index.css"
import type { ExcalidrawView } from "./excalidraw-types"

const MIN_PREVIEW_ZOOM = 0.35
const MAX_PREVIEW_ZOOM = 1.6
const VIEWPORT_ZOOM_FACTOR = 0.78
const RECENTER_DEBOUNCE_MS = 900

export default function ExcalidrawSketch({ view }: { view: ExcalidrawView }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const drawable = useMemo(
    () => view.elements.filter(element => element.type !== "cameraUpdate" && element.type !== "delete"),
    [view.elements]
  )
  const excalidrawElements = useMemo(
    () =>
      convertToExcalidrawElements(
        drawable.map(element => ({
          ...element,
          strokeColor: element.strokeColor || "#1e1e1e",
          backgroundColor: element.backgroundColor || "transparent",
          fillStyle: element.fillStyle || "solid",
          strokeWidth: element.strokeWidth ?? 2,
          roughness: 1,
          opacity: 100,
        })) as Parameters<typeof convertToExcalidrawElements>[0],
        { regenerateIds: false }
      ),
    [drawable]
  )
  const appState = useMemo(
    () => ({
      viewBackgroundColor: "#ffffff",
      currentItemStrokeColor: "#1e1e1e",
      currentItemBackgroundColor: "transparent",
      currentItemFillStyle: "solid" as const,
      currentItemStrokeWidth: 2,
      currentItemRoughness: 1,
      currentItemOpacity: 100,
    }),
    []
  )

  const centerContent = (animate: boolean, duration = 180) => {
    if (!api || api.isDestroyed || excalidrawElements.length === 0) return
    api.scrollToContent(excalidrawElements, {
      fitToViewport: true,
      viewportZoomFactor: VIEWPORT_ZOOM_FACTOR,
      minZoom: MIN_PREVIEW_ZOOM,
      maxZoom: MAX_PREVIEW_ZOOM,
      animate,
      duration,
    })
  }

  useEffect(() => {
    if (!api || api.isDestroyed) return
    api.updateScene({ elements: excalidrawElements, appState })
    window.setTimeout(() => {
      centerContent(true, 220)
    }, 0)
  }, [api, appState, excalidrawElements])

  useEffect(() => {
    if (!api || api.isDestroyed || excalidrawElements.length === 0) return
    let timeout: number | undefined
    const unsubscribe = api.onScrollChange(() => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => centerContent(true), RECENTER_DEBOUNCE_MS)
    })

    return () => {
      window.clearTimeout(timeout)
      unsubscribe()
    }
  }, [api, excalidrawElements])

  return (
    <figure className="my-2 overflow-hidden rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">
        {view.title || "Excalidraw view"}
      </div>
      <div
        className="h-[420px] w-full overflow-hidden bg-white"
        role="img"
        aria-label={view.title || "Excalidraw view"}
      >
        <Excalidraw
          initialData={{ elements: excalidrawElements, appState, scrollToContent: true }}
          onExcalidrawAPI={setApi}
          viewModeEnabled
          zenModeEnabled
          gridModeEnabled={false}
          detectScroll={false}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              toggleTheme: false,
            },
          }}
        />
      </div>
      <figcaption className="flex items-center justify-between border-t border-slate-200 px-3 py-1 text-xs text-slate-500">
        <span>{view.element_count ?? drawable.length} elements</span>
        {view.checkpoint_id && <span>checkpoint {view.checkpoint_id}</span>}
      </figcaption>
    </figure>
  )
}
