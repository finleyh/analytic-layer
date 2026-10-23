import { useEffect, useRef } from "react";
import * as d3 from "d3";

const DEFAULT_SCALE_EXTENT: [number, number] = [0.3, 4];

export function ZoomableSvg({
  width,
  height,
  scaleExtent = DEFAULT_SCALE_EXTENT,
  children,
}: {
  width: number;
  height: number;
  scaleExtent?: [number, number];
  children: React.ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(scaleExtent)
      // Surgical, not propagation-blocking: this only tells d3 not to
      // START a pan gesture for an event on a data-no-pan descendant (a
      // node running its own drag) — mirrors d3's own default filter (no
      // ctrl-click, no non-primary button). An earlier attempt called
      // stopPropagation() on a capture-phase listener instead, reasoning
      // that d3's bubble-phase mousedown.zoom listener needed beating —
      // true, but stopPropagation during capture also stops the event
      // from ever reaching the node's own target-phase handlers, silently
      // breaking the node's own drag at the same time it blocked zoom.
      .filter(
        (event) =>
          (!event.ctrlKey || event.type === "wheel") && !event.button && !(event.target as Element)?.closest?.("[data-no-pan]"),
      )
      .on("zoom", (event) => {
        d3.select(gRef.current).attr("transform", event.transform.toString());
      });
    d3.select(svgRef.current).call(zoomBehavior);
    return () => {
      d3.select(svgRef.current).on(".zoom", null);
    };
  }, [scaleExtent]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", left: 0, top: 0, cursor: "grab" }}
    >
      <g ref={gRef}>{children}</g>
    </svg>
  );
}
