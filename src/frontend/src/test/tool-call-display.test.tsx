import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ToolCallDisplay, parseDiagramResult } from "@/components/chat/ToolCallDisplay"

describe("ToolCallDisplay", () => {
  it("shows completed agent reasoning and tool activity when expanded", () => {
    render(
      <ToolCallDisplay
        name="architect_agent"
        args='{"input":"Design a test architecture"}'
        status="complete"
        progress={[
          { phase: "thinking", message: "architect_agent is thinking" },
          { phase: "tool", message: "architect_agent is using list_aws_services" },
          { phase: "text", message: "Drafting a minimal VPC and EC2 testing design" },
          { phase: "completed", message: "architect_agent completed" },
        ]}
        result="Minimal architecture output"
        agent={{
          id: "agent1",
          name: "InfraQ Orchestrator",
          avatar: "IQ",
          className: "bg-slate-950 text-white",
        }}
      />
    )

    expect(screen.queryByText("Agent reasoning and tools")).not.toBeInTheDocument()
    expect(screen.getByText("IQ")).toBeInTheDocument()
    expect(screen.getByText("InfraQ Orchestrator")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /architect_agent/i }))

    expect(screen.getByText("Agent reasoning and tools")).toBeInTheDocument()
    expect(screen.getByText("Thinking")).toBeInTheDocument()
    expect(screen.getByText("Tool")).toBeInTheDocument()
    expect(screen.getByText("architect_agent is using list_aws_services")).toBeInTheDocument()
    expect(screen.getByText("Drafting a minimal VPC and EC2 testing design")).toBeInTheDocument()
    expect(screen.getByText("Minimal architecture output")).toBeInTheDocument()
  })

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
        name="diagram"
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

  it("does not keep progress spinners visible for stopped tools", () => {
    const { container } = render(
      <ToolCallDisplay
        name="engineer_agent"
        args='{"input":"Fix the app"}'
        status="stopped"
        progress={[
          { phase: "started", message: "engineer_agent started" },
          { phase: "thinking", message: "engineer_agent is thinking" },
        ]}
      />
    )

    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument()
    expect(screen.queryByText("engineer_agent started")).not.toBeInTheDocument()
  })

  it("does not accept legacy embedded data URLs as diagram display input", () => {
    const result = JSON.stringify({
      ok: true,
      data_url: "data:image/svg+xml;base64,PHN2Zy8+",
      image_path: "/mnt/s3/sessions/test/architecture-diagrams/diagram.svg",
      mime_type: "image/svg+xml",
    })

    expect(parseDiagramResult("diagram", result)).toBeNull()
    expect(parseDiagramResult("file_read", result)).toBeNull()
  })
})
