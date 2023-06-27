import "test/mocks/lz4";
import _ from "lodash";
import test from "ava";
import TPS3D from "libs/thin_plate_spline";
import { almostEqual, getPointsC555 } from "./transform_spec_helpers";

test("Basic TPS calculation", async (t) => {
  const [sourcePoints, targetPoints] = getPointsC555();

  const tps = new TPS3D(sourcePoints, targetPoints);

  almostEqual(
    t,
    [568.1202797015036, 528.013612246682, 1622.1124501555569],
    tps.transform(570.3021, 404.5549, 502.22482),
  );

  almostEqual(
    t,
    [1574.679455809381, 1607.1773268624395, 1791.5425120096843],
    tps.transform(500, 501, 502),
  );
});
