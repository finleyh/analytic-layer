import { useEffect, useRef } from "react";
import * as d3 from "d3";

export function ZoomableSvg({
  width,
  height,
  scaleExtent = [0.3, 4],
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
