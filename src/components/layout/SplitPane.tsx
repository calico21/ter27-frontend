import React, { useCallback, useRef, useState } from "react";

interface SplitPaneProps {
  direction: "horizontal" | "vertical";
  initialRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  first: React.ReactNode;
  second: React.ReactNode;
  className?: string;
}

export function SplitPane({
  direction,
  initialRatio = 0.62,
  minRatio = 0.2,
  maxRatio = 0.82,
  first,
  second,
  className = "",
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState<number>(initialRatio);
  const [dragging, setDragging] = useState<boolean>(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      setDragging(true);

      const onMove = (ev: PointerEvent) => {
        const box = containerRef.current?.getBoundingClientRect();
        if (!box) return;
        const raw =
          direction === "horizontal"
            ? (ev.clientX - box.left) / Math.max(1, box.width)
            : (ev.clientY - box.top) / Math.max(1, box.height);
        setRatio(Math.max(minRatio, Math.min(maxRatio, raw)));
      };

      const onUp = () => {
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [direction, minRatio, maxRatio]
  );

  const isHorizontal = direction === "horizontal";

  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? "flex-row" : "flex-col"} w-full h-full min-w-0 min-h-0 overflow-hidden ${className}`}
    >
      <div
        className="min-w-0 min-h-0 overflow-hidden flex flex-col"
        style={{ flexBasis: `${(ratio * 100).toFixed(2)}%`, flexGrow: 0, flexShrink: 0 }}
      >
        {first}
      </div>
      <div
        role="separator"
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        data-dragging={dragging ? "true" : "false"}
        onPointerDown={onPointerDown}
        title="Drag to resize pane"
        className={isHorizontal ? "split-handle-h" : "split-handle-v"}
      />
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">{second}</div>
    </div>
  );
}
