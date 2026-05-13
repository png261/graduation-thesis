import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import ExcalidrawSketch from "@/components/chat/ExcalidrawSketch"

const mockExcalidraw = vi.hoisted(() => {
  const api = {
    isDestroyed: false,
    updateScene: vi.fn(),
    scrollToContent: vi.fn(),
    onScrollChange: vi.fn((callback: () => void) => {
      mockExcalidraw.scrollCallback = callback
      return mockExcalidraw.unsubscribe
    }),
  }
  return {
    api,
    scrollCallback: undefined as undefined | (() => void),
    unsubscribe: vi.fn(),
  }
})

vi.mock("@excalidraw/excalidraw", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    Excalidraw: ({ onExcalidrawAPI }: { onExcalidrawAPI?: (api: unknown) => void }) => {
      React.useEffect(() => {
        onExcalidrawAPI?.(mockExcalidraw.api)
      }, [onExcalidrawAPI])
      return <div data-testid="official-excalidraw" />
    },
    convertToExcalidrawElements: (elements: unknown) => elements,
  }
})

vi.mock("@excalidraw/excalidraw/index.css", () => ({}))

describe("ExcalidrawSketch", () => {
  beforeEach(() => {
    vi.useRealTimers()
    mockExcalidraw.api.isDestroyed = false
    mockExcalidraw.api.updateScene.mockClear()
    mockExcalidraw.api.scrollToContent.mockClear()
    mockExcalidraw.api.onScrollChange.mockClear()
    mockExcalidraw.unsubscribe.mockClear()
    mockExcalidraw.scrollCallback = undefined
  })

  it("fits the drawing to the preview with bounded zoom", async () => {
    render(
      <ExcalidrawSketch
        view={{
          ok: true,
          type: "excalidraw_view",
          title: "Centered preview",
          elements: [{ type: "rectangle", id: "box", x: 10, y: 10, width: 100, height: 60 }],
        }}
      />
    )

    await waitFor(() => expect(mockExcalidraw.api.scrollToContent).toHaveBeenCalled())

    expect(mockExcalidraw.api.scrollToContent).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({
        fitToViewport: true,
        viewportZoomFactor: 0.78,
        minZoom: 0.35,
        maxZoom: 1.6,
      })
    )
  })

  it("recenters after the embedded canvas scrolls or zooms", async () => {
    render(
      <ExcalidrawSketch
        view={{
          ok: true,
          type: "excalidraw_view",
          title: "Recentering preview",
          elements: [{ type: "rectangle", id: "box", x: 10, y: 10, width: 100, height: 60 }],
        }}
      />
    )

    await waitFor(() => expect(mockExcalidraw.api.onScrollChange).toHaveBeenCalled())
    vi.useFakeTimers()
    const callsBeforeScroll = mockExcalidraw.api.scrollToContent.mock.calls.length
    mockExcalidraw.scrollCallback?.()
    vi.advanceTimersByTime(900)

    expect(mockExcalidraw.api.scrollToContent.mock.calls.length).toBeGreaterThan(callsBeforeScroll)
  })
})
