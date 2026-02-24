"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
    direction: "horizontal" | "vertical";
    onResize: (delta: number) => void;
    className?: string;
}

export function ResizeHandle({
    direction,
    onResize,
    className,
}: ResizeHandleProps) {
    const [isDragging, setIsDragging] = useState(false);
    const startPosRef = useRef(0);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            setIsDragging(true);
            startPosRef.current =
                direction === "horizontal" ? e.clientX : e.clientY;
        },
        [direction]
    );

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            const currentPos =
                direction === "horizontal" ? e.clientX : e.clientY;
            const delta = currentPos - startPosRef.current;
            startPosRef.current = currentPos;
            onResize(delta);
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        // Prevent text selection while dragging
        document.body.style.userSelect = "none";
        document.body.style.cursor =
            direction === "horizontal" ? "col-resize" : "row-resize";

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };
    }, [isDragging, direction, onResize]);

    return (
        <div
            className={cn(
                "group relative shrink-0 transition-colors",
                direction === "horizontal"
                    ? "w-1 cursor-col-resize hover:bg-primary/20"
                    : "h-1 cursor-row-resize hover:bg-primary/20",
                isDragging && "bg-primary/30",
                className
            )}
            onMouseDown={handleMouseDown}
        >
            {/* Visual indicator line */}
            <div
                className={cn(
                    "absolute opacity-0 transition-opacity group-hover:opacity-100",
                    isDragging && "opacity-100",
                    direction === "horizontal"
                        ? "left-0 top-0 h-full w-full bg-primary/40"
                        : "left-0 top-0 h-full w-full bg-primary/40"
                )}
            />
        </div>
    );
}
