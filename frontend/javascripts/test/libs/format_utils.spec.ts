import test from "ava";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";
import _ from "lodash";
import { LengthUnit, Unicode } from "oxalis/constants";

const { ThinSpace } = Unicode;
// TODO: Improve tests to check different base units and not just nm.
// TODO: Test conversion from uncommon units to common units.
const unitsToTest = [
  LengthUnit.ym,
  LengthUnit.zm,
  LengthUnit.am,
  LengthUnit.fm,
  LengthUnit.pm,
  LengthUnit.nm,
  LengthUnit.µm,
  LengthUnit.mm,
  LengthUnit.m,
  LengthUnit.km,
  LengthUnit.Mm,
  LengthUnit.Gm,
  LengthUnit.Tm,
  LengthUnit.Pm,
  LengthUnit.Em,
  LengthUnit.Zm,
  LengthUnit.Ym,
];
test("Format number to length", (t) => {
  const simpleLengths = _.range(-14, 15).map((exp) => Math.pow(10, exp));
  unitsToTest.forEach((unit, index) => {
    if (unit === LengthUnit.ym || unit === LengthUnit.Ym) {
      // Skip these units for now as they have not enough lower && higher units to test.
      return;
    }

    // Keeps the index access to unitsToTest in bounds. If out of bounds
    const guardExpectedValue = (expectedValue: number, index: number) => {
      expectedValue =
        index >= unitsToTest.length
          ? expectedValue * 1000 ** (index - unitsToTest.length + 1)
          : expectedValue;
      const isInt = expectedValue % 1 === 0;
      const maybeTrailingZero = isInt ? ".0" : "";
      return index < 0
        ? `0.0${ThinSpace}${unitsToTest[0]}`
        : index >= unitsToTest.length
          ? `${expectedValue}${maybeTrailingZero}${ThinSpace}${unitsToTest[unitsToTest.length - 1]}`
          : `${expectedValue}${maybeTrailingZero}${ThinSpace}${unitsToTest[index]}`;
    };
    t.deepEqual(
      [
        guardExpectedValue(10, index - 5),
        guardExpectedValue(0.1, index - 4),
        guardExpectedValue(1, index - 4),
        guardExpectedValue(10, index - 4),
        guardExpectedValue(0.1, index - 3),
        guardExpectedValue(1, index - 3),
        guardExpectedValue(10, index - 3),
        guardExpectedValue(0.1, index - 2),
        guardExpectedValue(1, index - 2),
        guardExpectedValue(10, index - 2),
        guardExpectedValue(0.1, index - 1),
        guardExpectedValue(1, index - 1),
        guardExpectedValue(10, index - 1),
        guardExpectedValue(0.1, index),
        guardExpectedValue(1, index),
        guardExpectedValue(10, index),
        guardExpectedValue(0.1, index + 1),
        guardExpectedValue(1, index + 1),
        guardExpectedValue(10, index + 1),
        guardExpectedValue(0.1, index + 2),
        guardExpectedValue(1, index + 2),
        guardExpectedValue(10, index + 2),
        guardExpectedValue(0.1, index + 3),
        guardExpectedValue(1, index + 3),
        guardExpectedValue(10, index + 3),
        guardExpectedValue(0.1, index + 4),
        guardExpectedValue(1, index + 4),
        guardExpectedValue(10, index + 4),
        guardExpectedValue(0.1, index + 5),
      ],
      simpleLengths.map((length) => formatNumberToLength(length, unit)),
    );
  });

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
    lengthsWithFactorInNm.map((length) => formatNumberToLength(length, LengthUnit.nm)),
  );

  const advancedLengthsInNm = [1e6, 12, 1e-5, 1e-17, 1234e12, 1234e33];
  t.deepEqual(
    [
      `1.0${ThinSpace}mm`,
      `12.0${ThinSpace}nm`,
      `10.0${ThinSpace}fm`,
      `0.0${ThinSpace}ym`,
      `1.2${ThinSpace}Mm`,
      `1234.0${ThinSpace}Ym`,
    ],
    advancedLengthsInNm.map((length) => formatNumberToLength(length, LengthUnit.nm)),
  );

  t.deepEqual(`0.01${ThinSpace}pm`, formatNumberToLength(1e-5, LengthUnit.nm, 2));
});

test("Format number to area", (t) => {
  const areasToTest = [
    1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1, 107e-6, 107, 107e6, 107e12, 107e18, 107e22, 107e23,
    107e24, 107e25,
  ];

  //unitsToTest.forEach((unit, index) => {
  const index = 5;
  const unit = unitsToTest[index];
  if (unit === LengthUnit.ym || unit === LengthUnit.Ym) {
    // Skip these units for now as they have not enough lower && higher units to test.
    return;
  }

  // Keeps the index access to unitsToTest in bounds. If out of bounds
  const guardExpectedValue = (expectedValue: number, index: number) => {
    const isInt = expectedValue % 1 === 0;
    const maybeTrailingZero = isInt ? ".0" : "";
    return index < 0
      ? `0.0${ThinSpace}${unitsToTest[0]}²`
      : index >= unitsToTest.length
        ? `${
            // TODO: This needs to be adjusted to the dimmesions -> factor ** 2 -> 1000 ** (factor*2); and for volume 1000 ** (factor*3)
            // TODO: Unify these tests to not have duplicate ones and use the dimension as a parameter or such
            expectedValue * 1000 ** (index - unitsToTest.length + 1)
          }${maybeTrailingZero}${ThinSpace}${unitsToTest[unitsToTest.length - 1]}²`
        : `${expectedValue}${maybeTrailingZero}${ThinSpace}${unitsToTest[index]}²`;
  };
  t.deepEqual(
    [
      guardExpectedValue(1, index - 1),
      guardExpectedValue(10, index - 1),
      guardExpectedValue(100, index - 1),
      guardExpectedValue(1000, index - 1),
      guardExpectedValue(10000, index - 1),
      guardExpectedValue(0.1, index),
      guardExpectedValue(1, index),
      guardExpectedValue(107, index - 1),
      guardExpectedValue(107, index),
      guardExpectedValue(107, index + 1),
      guardExpectedValue(107, index + 2),
      guardExpectedValue(107, index + 3),
      guardExpectedValue(1.1, index + 4),
      guardExpectedValue(10.7, index + 4),
      guardExpectedValue(107, index + 4),
      guardExpectedValue(1070, index + 4),
    ],
    areasToTest.map((area) => formatNumberToArea(area, LengthUnit.nm)),
  );
  //});
  t.deepEqual(`0.10${ThinSpace}pm²`, formatNumberToArea(1e-7, LengthUnit.nm, 2));
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
    volumesInNm3.map((volume) => formatNumberToVolume(volume, LengthUnit.nm)),
  );
  t.deepEqual(`0.01${ThinSpace}nm³`, formatNumberToVolume(1e-2, LengthUnit.nm, 2));
});
