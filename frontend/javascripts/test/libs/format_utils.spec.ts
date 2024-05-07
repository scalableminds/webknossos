import test from "ava";
import {
  formatNumberInDatasourceUnitToArea,
  formatNumberInUnitToLength,
  formatNumberToVolume,
} from "libs/format_utils";
import _ from "lodash";
import { LengthUnit, Unicode } from "oxalis/constants";

const { ThinSpace } = Unicode;
// TODO: Improve tests to check different base units and not just nm.
test("Format number to length", (t) => {
  const simpleLengthsInNm = _.range(-5, 15).map((exp) => Math.pow(10, exp));
  t.deepEqual(
    [
      `0.0${ThinSpace}pm`,
      `0.1${ThinSpace}pm`,
      `1${ThinSpace}pm`,
      `10${ThinSpace}pm`,
      `0.1${ThinSpace}nm`,
      `1${ThinSpace}nm`,
      `10${ThinSpace}nm`,
      `0.1${ThinSpace}µm`,
      `1${ThinSpace}µm`,
      `10${ThinSpace}µm`,
      `0.1${ThinSpace}mm`,
      `1${ThinSpace}mm`,
      `10${ThinSpace}mm`,
      `0.1${ThinSpace}m`,
      `1${ThinSpace}m`,
      `10${ThinSpace}m`,
      `0.1${ThinSpace}km`,
      `1${ThinSpace}km`,
      `10${ThinSpace}km`,
      `100${ThinSpace}km`,
    ],
    simpleLengthsInNm.map((length) => formatNumberInUnitToLength(length, LengthUnit.nm)),
  );

  const lengthsWithFactorInNm = _.range(-5, 1).map((exp) => 107 * Math.pow(10, exp));
  t.deepEqual(
    [
      `1.1${ThinSpace}pm`,
      `10.7${ThinSpace}pm`,
      `0.1${ThinSpace}nm`,
      `1.1${ThinSpace}nm`,
      `10.7${ThinSpace}nm`,
      `0.1${ThinSpace}µm`,
    ],
    lengthsWithFactorInNm.map((length) => formatNumberInUnitToLength(length, LengthUnit.nm)),
  );

  const advancedLengthsInNm = [1e6, 12, 1e-5, 1234e12];
  t.deepEqual(
    [`1${ThinSpace}mm`, `12${ThinSpace}nm`, `0.0${ThinSpace}pm`, `1234${ThinSpace}km`],
    advancedLengthsInNm.map((length) => formatNumberInUnitToLength(length, LengthUnit.nm)),
  );

  t.deepEqual(`0.01${ThinSpace}pm`, formatNumberInUnitToLength(1e-5, LengthUnit.nm, 2));
});

test("Format number to area", (t) => {
  const areasInNm2 = [
    1e-6, 1e-5, 1e-4, 1e-3, 1, 107e-6, 107, 107e6, 107e12, 107e18, 107e22, 107e23, 107e24, 107e25,
  ];
  t.deepEqual(
    [
      `1${ThinSpace}pm²`,
      `10.0${ThinSpace}pm²`, // because of floating point representation, also true for some examples below
      `100.0${ThinSpace}pm²`,
      `1000.0${ThinSpace}pm²`,
      `1${ThinSpace}nm²`,
      `107${ThinSpace}pm²`,
      `107${ThinSpace}nm²`,
      `107${ThinSpace}µm²`,
      `107${ThinSpace}mm²`,
      `107${ThinSpace}m²`,
      `1.1${ThinSpace}km²`,
      `10.7${ThinSpace}km²`,
      `107.0${ThinSpace}km²`,
      `1070${ThinSpace}km²`,
    ],
    areasInNm2.map((area) => formatNumberInDatasourceUnitToArea(area, "nm")),
  );
  t.deepEqual(`0.10${ThinSpace}pm²`, formatNumberInDatasourceUnitToArea(1e-7, "nm", 2));
});

test("Format number to volume", (t) => {
  const volumesInNm3 = [
    1e-9, 1e-6, 107e-9, 107, 107e9, 107e10, 107e11, 107e12, 107e13, 107e14, 107e15, 107e16, 107e17,
    107e18, 107e27, 107e36,
  ];
  t.deepEqual(
    [
      `1${ThinSpace}pm³`,
      `1000.0${ThinSpace}pm³`, // because of floating point representation
      `107${ThinSpace}pm³`,
      `107${ThinSpace}nm³`,
      `107${ThinSpace}µm³`,
      `1070${ThinSpace}µm³`,
      `10700${ThinSpace}µm³`,
      `107000${ThinSpace}µm³`,
      `1070000${ThinSpace}µm³`,
      `10700000${ThinSpace}µm³`,
      `0.1${ThinSpace}mm³`,
      `1.1${ThinSpace}mm³`,
      `10.7${ThinSpace}mm³`,
      `107${ThinSpace}mm³`,
      `107${ThinSpace}m³`,
      `107${ThinSpace}km³`,
    ],
    volumesInNm3.map((volume) => formatNumberToVolume(volume)),
  );
  t.deepEqual(`0.01${ThinSpace}nm³`, formatNumberToVolume(1e-2, 2));
});
