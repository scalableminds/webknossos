import "../mocks/lz4";
import { describe, it, expect } from "vitest";
import TPS3D from "libs/thin_plate_spline";
import { almostEqual, getPointsC555 } from "./transform_spec_helpers";
import { V3 } from "libs/mjs";
import type { Vector3 } from "oxalis/constants";

describe("Thin Plate Spline", () => {
  it("Basic TPS calculation", async () => {
    const [sourcePoints, targetPoints] = getPointsC555();

    const tps = new TPS3D(sourcePoints, targetPoints, [1, 1, 1]);

    almostEqual(
      expect,
      [568.1202797015036, 528.013612246682, 1622.1124501555569],
      tps.transform(570.3021, 404.5549, 502.22482),
    );

    almostEqual(
      expect,
      [1574.679455809381, 1607.1773268624395, 1791.5425120096843],
      tps.transform(500, 501, 502),
    );
  });

  it("TPS calculation with scale", async () => {
    const [sourcePoints, targetPoints] = getPointsC555();
    const scale = [11, 12, 13] as Vector3;
    const tps = new TPS3D(sourcePoints, targetPoints, scale);
    const s = (el: Vector3) => V3.scale3(el, scale);

    almostEqual(
      expect,
      s([202.37820938461536, 656.9199393846154, 3268.6702726153844]),
      tps.transform(...s([542.191067465668, 386.53899285892635, 370.4734697627965])),
    );

    almostEqual(
      expect,
      s([1508.3328498461537, 1977.8310726153848, 185.3605911476923]),
      tps.transform(...s([482.1100102621723, 492.8521135830212, 633.5717351310861])),
    );
  });
});
