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

// Keeps the index access to unitsToTest in bounds. If out of bounds
const guardExpectedValue = (expectedValue: number, index: number, dimension: number) => {
  expectedValue =
    index >= unitsToTest.length
      ? expectedValue * 1000 ** ((index - unitsToTest.length + 1) * dimension)
      : expectedValue;
  expectedValue = Math.round(expectedValue * 10) / 10; // Rounding to one decimal as done by calls to the formatting functions per default.
  const unitPostfix = dimension === 1 ? "" : dimension === 2 ? "²" : "³";
  const isInt = expectedValue % 1 === 0;
  const maybeTrailingZero = isInt ? ".0" : "";
  return index < 0
    ? `0.0${ThinSpace}${unitsToTest[0]}${unitPostfix}`
    : index >= unitsToTest.length
      ? `${expectedValue}${maybeTrailingZero}${ThinSpace}${
          unitsToTest[unitsToTest.length - 1]
        }${unitPostfix}`
      : `${expectedValue}${maybeTrailingZero}${ThinSpace}${unitsToTest[index]}${unitPostfix}`;
};

test("Format number to length", (t) => {
  const simpleLengths = _.range(-14, 15).map((exp) => Math.pow(10, exp)); // 1, 10, 100, 1000, ...
  const moreComplexLengths = _.range(-14, 15).map(
    (exp) => Math.pow(10, exp) + Math.pow(10, exp - 1) * 7,
  ); // In format of: 1.7, 17, 170, 1700, ...
  const testLengthsArray = (lengthsArray: number[], offset: number) => {
    unitsToTest.forEach((unit, index) => {
      /*if (unit === LengthUnit.ym || unit === LengthUnit.Ym) {
        // Skip these units for now as they have not enough lower && higher units to test.
        return;
      }*/
      const baseOffset = offset;
      const offsetDecimal1 = offset / 10;
      const offsetDecimal2 = offset / 100;
      t.deepEqual(
        [
          guardExpectedValue(10 + baseOffset, index - 5, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index - 4, 1),
          guardExpectedValue(1 + offsetDecimal1, index - 4, 1),
          guardExpectedValue(10 + baseOffset, index - 4, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index - 3, 1),
          guardExpectedValue(1 + offsetDecimal1, index - 3, 1),
          guardExpectedValue(10 + baseOffset, index - 3, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index - 2, 1),
          guardExpectedValue(1 + offsetDecimal1, index - 2, 1),
          guardExpectedValue(10 + baseOffset, index - 2, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index - 1, 1),
          guardExpectedValue(1 + offsetDecimal1, index - 1, 1),
          guardExpectedValue(10 + baseOffset, index - 1, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index, 1),
          guardExpectedValue(1 + offsetDecimal1, index, 1),
          guardExpectedValue(10 + baseOffset, index, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index + 1, 1),
          guardExpectedValue(1 + offsetDecimal1, index + 1, 1),
          guardExpectedValue(10 + baseOffset, index + 1, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index + 2, 1),
          guardExpectedValue(1 + offsetDecimal1, index + 2, 1),
          guardExpectedValue(10 + baseOffset, index + 2, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index + 3, 1),
          guardExpectedValue(1 + offsetDecimal1, index + 3, 1),
          guardExpectedValue(10 + baseOffset, index + 3, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index + 4, 1),
          guardExpectedValue(1 + offsetDecimal1, index + 4, 1),
          guardExpectedValue(10 + baseOffset, index + 4, 1),
          guardExpectedValue(0.1 + offsetDecimal2, index + 5, 1),
        ],
        lengthsArray.map((length) => formatNumberToLength(length, unit)),
      );
    });
  };
  testLengthsArray(simpleLengths, 0);
  testLengthsArray(moreComplexLengths, 7);

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
  const simpleAreas = _.range(-10, 25).map((exp) => Math.pow(10, exp)); // 1, 10, 100, 1000, ...
  const moreComplexAreas = _.range(-10, 25).map(
    (exp) => Math.pow(10, exp) + Math.pow(10, exp - 1) * 7,
  ); // In format of: 1.7, 17, 170, 1700, ...
  const testLengthsArray = (lengthsArray: number[], offset: number) => {
    unitsToTest.forEach((unit, index) => {
      if (unit === LengthUnit.ym || unit === LengthUnit.Ym || unit === LengthUnit.Zm) {
        // Skip these units for now as they have not enough lower / higher units to test as the conversion where only
        // one unit exists above leads to very high numbers and thus inaccurate calculations which would fail the tests.
        return;
      }
      const baseOffset = offset;
      const offsetTimes10 = offset * 10;
      const offsetTimes100 = offset * 100;
      const offsetTimes1000 = offset * 1000;
      const offsetDecimal1 = offset / 10;
      const offsetDecimal2 = offset / 100;
      t.deepEqual(
        [
          guardExpectedValue(100 + offsetTimes10, index - 2, 2),
          guardExpectedValue(1000 + offsetTimes100, index - 2, 2),
          guardExpectedValue(10000 + offsetTimes1000, index - 2, 2),
          guardExpectedValue(0.1 + offsetDecimal2, index - 1, 2),
          guardExpectedValue(1 + offsetDecimal1, index - 1, 2),
          guardExpectedValue(10 + baseOffset, index - 1, 2),
          guardExpectedValue(100 + offsetTimes10, index - 1, 2),
          guardExpectedValue(1000 + offsetTimes100, index - 1, 2),
          guardExpectedValue(10000 + offsetTimes1000, index - 1, 2),
          guardExpectedValue(0.1 + offsetDecimal2, index, 2),
          guardExpectedValue(1 + offsetDecimal1, index, 2),
          guardExpectedValue(10 + baseOffset, index, 2),
          guardExpectedValue(100 + offsetTimes10, index, 2),
          guardExpectedValue(1000 + offsetTimes100, index, 2),
          guardExpectedValue(10000 + offsetTimes1000, index, 2),
          guardExpectedValue(0.1 + offsetDecimal2, index + 1, 2),
          guardExpectedValue(1 + offsetDecimal1, index + 1, 2),
          guardExpectedValue(10 + baseOffset, index + 1, 2),
          guardExpectedValue(100 + offsetTimes10, index + 1, 2),
          guardExpectedValue(1000 + offsetTimes100, index + 1, 2),
          guardExpectedValue(10000 + offsetTimes1000, index + 1, 2),
          guardExpectedValue(0.1 + offsetDecimal2, index + 2, 2),
          guardExpectedValue(1 + offsetDecimal1, index + 2, 2),
          guardExpectedValue(10 + baseOffset, index + 2, 2),
          guardExpectedValue(100 + offsetTimes10, index + 2, 2),
          guardExpectedValue(1000 + offsetTimes100, index + 2, 2),
          guardExpectedValue(10000 + offsetTimes1000, index + 2, 2),
          guardExpectedValue(0.1 + offsetDecimal2, index + 3, 2),
          guardExpectedValue(1 + offsetDecimal1, index + 3, 2),
          guardExpectedValue(10 + baseOffset, index + 3, 2),
          guardExpectedValue(100 + offsetTimes10, index + 3, 2),
          guardExpectedValue(1000 + offsetTimes100, index + 3, 2),
          guardExpectedValue(10000 + offsetTimes1000, index + 3, 2),
          guardExpectedValue(0.1 + offsetDecimal2, index + 4, 2),
          guardExpectedValue(1 + offsetDecimal1, index + 4, 2),
        ],
        lengthsArray.map((area) => formatNumberToArea(area, unit)),
      );
    });
  };
  testLengthsArray(simpleAreas, 0);
  testLengthsArray(moreComplexAreas, 7);
  t.deepEqual(`0.10${ThinSpace}pm²`, formatNumberToArea(1e-7, LengthUnit.nm, 2));
});

test("Format number to volume", (t) => {
  const simpleVolumes = _.range(-10, 25).map((exp) => Math.pow(10, exp)); // 1, 10, 100, 1000, ...
  const moreComplexVolumes = _.range(-10, 25).map(
    (exp) => Math.pow(10, exp) + Math.pow(10, exp - 1) * 7,
  ); // In format of: 1.7, 17, 170, 1700, ...
  const testLengthsArray = (lengthsArray: number[], offset: number) => {
    unitsToTest.forEach((unit, index) => {
      if (unit === LengthUnit.ym || unit === LengthUnit.Ym || unit === LengthUnit.Zm) {
        // Skip these units for now as they have not enough lower / higher units to test as the conversion where only
        // one unit exists above leads to very high numbers and thus inaccurate calculations which would fail the tests.
        return;
      }
      const baseOffset = offset;
      const offsetTimes10 = offset * 10;
      const offsetTimes100 = offset * 100;
      const offsetTimes1000 = offset * 1000;
      const offsetTimes10000 = offset * 10000;
      const offsetTimes100000 = offset * 100000;
      const offsetTimes1000000 = offset * 1000000;
      const offsetDecimal1 = offset / 10;
      const offsetDecimal2 = offset / 100;
      t.deepEqual(
        [
          guardExpectedValue(0.1 + offsetDecimal2, index - 1, 3),
          guardExpectedValue(1 + offsetDecimal1, index - 1, 3),
          guardExpectedValue(10 + baseOffset, index - 1, 3),
          guardExpectedValue(100 + offsetTimes10, index - 1, 3),
          guardExpectedValue(1000 + offsetTimes100, index - 1, 3),
          guardExpectedValue(10000 + offsetTimes1000, index - 1, 3),
          guardExpectedValue(100000 + offsetTimes10000, index - 1, 3),
          guardExpectedValue(1000000 + offsetTimes100000, index - 1, 3),
          guardExpectedValue(10000000 + offsetTimes1000000, index - 1, 3),
          guardExpectedValue(0.1 + offsetDecimal2, index, 3),
          guardExpectedValue(1 + offsetDecimal1, index, 3),
          guardExpectedValue(10 + baseOffset, index, 3),
          guardExpectedValue(100 + offsetTimes10, index, 3),
          guardExpectedValue(1000 + offsetTimes100, index, 3),
          guardExpectedValue(10000 + offsetTimes1000, index, 3),
          guardExpectedValue(100000 + offsetTimes10000, index, 3),
          guardExpectedValue(1000000 + offsetTimes100000, index, 3),
          guardExpectedValue(10000000 + offsetTimes1000000, index, 3),
          guardExpectedValue(0.1 + offsetDecimal2, index + 1, 3),
          guardExpectedValue(1 + offsetDecimal1, index + 1, 3),
          guardExpectedValue(10 + baseOffset, index + 1, 3),
          guardExpectedValue(100 + offsetTimes10, index + 1, 3),
          guardExpectedValue(1000 + offsetTimes100, index + 1, 3),
          guardExpectedValue(10000 + offsetTimes1000, index + 1, 3),
          guardExpectedValue(100000 + offsetTimes10000, index + 1, 3),
          guardExpectedValue(1000000 + offsetTimes100000, index + 1, 3),
          guardExpectedValue(10000000 + offsetTimes1000000, index + 1, 3),
          guardExpectedValue(0.1 + offsetDecimal2, index + 2, 3),
          guardExpectedValue(1 + offsetDecimal1, index + 2, 3),
          guardExpectedValue(10 + baseOffset, index + 2, 3),
          guardExpectedValue(100 + offsetTimes10, index + 2, 3),
          guardExpectedValue(1000 + offsetTimes100, index + 2, 3),
          guardExpectedValue(10000 + offsetTimes1000, index + 2, 3),
          guardExpectedValue(100000 + offsetTimes10000, index + 2, 3),
          guardExpectedValue(1000000 + offsetTimes100000, index + 2, 3),
        ],
        lengthsArray.map((area) => formatNumberToVolume(area, unit)),
      );
    });
  };
  testLengthsArray(simpleVolumes, 0);
  testLengthsArray(moreComplexVolumes, 7);

  t.deepEqual(`0.01${ThinSpace}nm³`, formatNumberToVolume(1e-2, LengthUnit.nm, 2));
});
