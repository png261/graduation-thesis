import { cn } from "@/lib/utils"
import type { CSSProperties } from "react"

interface ShinyTextProps {
  text: string
  className?: string
  shineColor?: string
  speed?: number
}

export function ShinyText({
  text,
  className,
  shineColor = "#ffffff",
  speed = 3,
}: ShinyTextProps) {
  return (
    <span
      className={cn(
        "inline-block bg-clip-text",
        "bg-[length:200%_100%]",
        "animate-[shiny-text_var(--shiny-speed)_linear_infinite]",
        className
      )}
      style={{
        "--shiny-speed": `${speed}s`,
        backgroundImage: `linear-gradient(110deg, currentColor 0%, currentColor 35%, ${shineColor} 50%, currentColor 65%, currentColor 100%)`,
        WebkitTextFillColor: "transparent",
      } as CSSProperties}
    >
      {text}
    </span>
  )
}
