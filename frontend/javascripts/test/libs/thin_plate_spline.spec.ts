import "test/mocks/lz4";
import _ from "lodash";
import test from "ava";
import { tps } from "libs/thin_plate_spline";

test("Basic TPS calculation", async (t) => {
  tps();
});
