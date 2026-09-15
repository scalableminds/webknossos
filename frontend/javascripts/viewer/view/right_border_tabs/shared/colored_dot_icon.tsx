import type { Vector4 } from "viewer/constants";
import { rgbaToCSS } from "viewer/shaders/utils.glsl";

export function ColoredDotIcon({ colorRGBA }: { colorRGBA: Vector4 }) {
  const rgbaCss = rgbaToCSS(colorRGBA);

  return (
    <span
      className="circle"
      style={{
        backgroundColor: rgbaCss,
        marginLeft: 4,
      }}
    />
  );
}
