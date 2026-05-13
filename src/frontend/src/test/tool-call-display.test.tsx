import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ToolCallDisplay, parseDiagramResult, parseExcalidrawView } from "@/components/chat/ToolCallDisplay"

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => <div data-testid="official-excalidraw" />,
  convertToExcalidrawElements: (elements: unknown) => elements,
}))

vi.mock("@excalidraw/excalidraw/index.css", () => ({}))

describe("ToolCallDisplay", () => {
  it("renders architecture diagrams from a public URL instead of a data URL", () => {
    const result = JSON.stringify({
      ok: true,
      public_url: "https://example.com/diagram.svg?signature=test",
      public_url_expires_in: 3600,
      image_key: "shared/sessions/test/architecture-diagrams/diagram.svg",
      image_path: "/mnt/s3/sessions/test/architecture-diagrams/diagram.svg",
      source_path: "/mnt/s3/sessions/test/architecture-diagrams/diagram.py",
      mime_type: "image/svg+xml",
    })

    render(
      <ToolCallDisplay
        name="render_architecture_diagram"
        args="{}"
        status="complete"
        result={result}
      />
    )

    const image = screen.getByAltText("Rendered architecture diagram")
    expect(image).toHaveAttribute("src", "https://example.com/diagram.svg?signature=test")
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute(
      "href",
      "https://example.com/diagram.svg?signature=test"
    )
  })

  it("does not accept legacy embedded data URLs as diagram display input", () => {
    const result = JSON.stringify({
      ok: true,
      data_url: "data:image/svg+xml;base64,PHN2Zy8+",
      image_path: "/mnt/s3/sessions/test/architecture-diagrams/diagram.svg",
      mime_type: "image/svg+xml",
    })

    expect(parseDiagramResult("render_architecture_diagram", result)).toBeNull()
  })

  it("renders Excalidraw-compatible streamed views", async () => {
    const result = JSON.stringify({
      ok: true,
      type: "excalidraw_view",
      title: "Agent handoff",
      checkpoint_id: "abc123",
      elements: [
        { type: "cameraUpdate", width: 800, height: 600, x: 0, y: 0 },
        {
          type: "rectangle",
          id: "agent",
          x: 120,
          y: 120,
          width: 180,
          height: 80,
          backgroundColor: "#d0bfff",
          fillStyle: "solid",
          label: { text: "Agent", fontSize: 18 },
        },
        {
          type: "arrow",
          id: "handoff",
          x: 300,
          y: 160,
          width: 140,
          height: 0,
          points: [[0, 0], [140, 0]],
          endArrowhead: "arrow",
        },
      ],
      element_count: 3,
    })

    render(<ToolCallDisplay name="create_excalidraw_view" args="{}" status="complete" result={result} />)

    expect(await screen.findByRole("img", { name: "Agent handoff" })).toBeInTheDocument()
    expect(await screen.findByTestId("official-excalidraw")).toBeInTheDocument()
    expect(screen.getByText("checkpoint abc123")).toBeInTheDocument()
  })

  it("keeps generated Excalidraw JSON out of the visible tool details", async () => {
    const args = JSON.stringify({
      title: "Hidden JSON",
      elements: JSON.stringify([
        {
          type: "rectangle",
          id: "secret-json-marker",
          x: 10,
          y: 10,
          width: 100,
          height: 60,
        },
      ]),
    })
    const result = JSON.stringify({
      ok: true,
      type: "excalidraw_view",
      title: "Hidden JSON",
      elements: [{ type: "rectangle", id: "result-json-marker", x: 10, y: 10, width: 100, height: 60 }],
    })

    render(<ToolCallDisplay name="create_excalidraw_view" args={args} status="complete" result={result} />)

    expect(await screen.findByRole("img", { name: "Hidden JSON" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /create_excalidraw_view/i }))

    expect(screen.queryByText("Input")).not.toBeInTheDocument()
    expect(screen.queryByText("Result")).not.toBeInTheDocument()
    expect(screen.queryByText(/secret-json-marker/)).not.toBeInTheDocument()
    expect(screen.queryByText(/result-json-marker/)).not.toBeInTheDocument()
  })

  it("can parse an Excalidraw view from complete streamed tool input before result", () => {
    const args = JSON.stringify({
      title: "Streaming workflow",
      elements: JSON.stringify([
        { type: "rectangle", id: "start", x: 20, y: 20, width: 100, height: 60, label: { text: "Start" } },
      ]),
    })

    expect(parseExcalidrawView("create_excalidraw_view", undefined, args)?.title).toBe("Streaming workflow")
  })

  it("renders completed elements from partial streamed tool input", async () => {
    const partialArgs =
      '{"elements":"[{\\"type\\":\\"cameraUpdate\\",\\"width\\":800,\\"height\\":600,\\"x\\":0,\\"y\\":0},' +
      '{\\"type\\":\\"rectangle\\",\\"id\\":\\"user\\",\\"x\\":80,\\"y\\":100,\\"width\\":160,\\"height\\":70,' +
      '\\"backgroundColor\\":\\"#a5d8ff\\",\\"fillStyle\\":\\"solid\\",\\"label\\":{\\"text\\":\\"User\\",\\"fontSize\\":18}},' +
      '{\\"type\\":\\"rectangle\\",\\"id\\":\\"agent\\",\\"x\\":320,'

    const view = parseExcalidrawView("create_excalidraw_view", undefined, partialArgs)

    expect(view?.source).toBe("partial-streaming-tool-input")
    expect(view?.elements).toHaveLength(2)

    render(<ToolCallDisplay name="create_excalidraw_view" args={partialArgs} status="streaming" />)

    expect(await screen.findByRole("img", { name: "Streaming sketch" })).toBeInTheDocument()
    expect(await screen.findByTestId("official-excalidraw")).toBeInTheDocument()
  })
})
