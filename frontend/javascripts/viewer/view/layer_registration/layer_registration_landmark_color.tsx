import type { Vector3 } from "viewer/constants";

function getRgbColorString(color: Vector3): string {
  return `rgb(${color.map((component) => Math.round(component * 255)).join(",")})`;
}

// The color that both landmarks of a pair have in the views (see getLandmarkColor). The
// .landmark-color class adds a ring that keeps light and dark colors visible in both themes.
export function LandmarkColorDot({ color, hasGap = true }: { color: Vector3; hasGap?: boolean }) {
  return (
    <span
      className="landmark-color"
      style={{ background: getRgbColorString(color), marginRight: hasGap ? undefined : 0 }}
    />
  );
}
