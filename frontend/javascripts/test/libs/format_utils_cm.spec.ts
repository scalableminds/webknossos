import test from "ava";
import _ from "lodash";
import { LengthUnit, Unicode } from "oxalis/constants";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";

const { ThinSpace } = Unicode;

test("Format number to length with cm", (t) => {
  t.is(`0.0${ThinSpace}cm`, formatNumberToLength(0, LengthUnit.cm));
  t.is(`0.1${ThinSpace}cm`, formatNumberToLength(0.1, LengthUnit.cm));
  t.is(`1.0${ThinSpace}cm`, formatNumberToLength(10, LengthUnit.mm));
  t.is(`4.8${ThinSpace}cm`, formatNumberToLength(48, LengthUnit.mm));
  t.is(`1.6${ThinSpace}cm`, formatNumberToLength(16000, LengthUnit.µm));
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(0.012, LengthUnit.m));
});

test("Format number to area with cm", (t) => {
  t.is(`0.0${ThinSpace}cm²`, formatNumberToArea(0, LengthUnit.cm));
  t.is(`0.1${ThinSpace}cm²`, formatNumberToArea(0.1, LengthUnit.cm));
  t.is(`0.1${ThinSpace}cm²`, formatNumberToArea(10, LengthUnit.mm));
  t.is(`1.0${ThinSpace}cm²`, formatNumberToArea(100, LengthUnit.mm));
  t.is(`0.5${ThinSpace}cm²`, formatNumberToArea(48, LengthUnit.mm));
  t.is(`16.0${ThinSpace}cm²`, formatNumberToArea(1600000000, LengthUnit.µm));
  t.is(`1.2${ThinSpace}cm²`, formatNumberToArea(0.00012, LengthUnit.m));
});

test("Format number to volume with cm", (t) => {
  t.is(`0.0${ThinSpace}cm³`, formatNumberToVolume(0, LengthUnit.cm));
  t.is(`0.1${ThinSpace}cm³`, formatNumberToVolume(0.1, LengthUnit.cm));
  t.is(`0.1${ThinSpace}cm³`, formatNumberToVolume(100, LengthUnit.mm));
  t.is(`1.0${ThinSpace}cm³`, formatNumberToVolume(1000, LengthUnit.mm));
  t.is(`0.5${ThinSpace}cm³`, formatNumberToVolume(480, LengthUnit.mm));
  t.is(`16.0${ThinSpace}cm³`, formatNumberToVolume(16e12, LengthUnit.µm));
  t.is(`120.0${ThinSpace}cm³`, formatNumberToVolume(0.00012, LengthUnit.m));
});

/*test("Format number to length and test precision", (t) => {
  // TODO: Fix with different precision. But first check whether the precision parameter is actually used.
  //t.is(`1.2${ThinSpace}cm`, formatNumberToLength(1.23456789, LengthUnit.cm));
  //t.is(`1.23${ThinSpace}cm`, formatNumberToLength(1.23456789, LengthUnit.cm, 2));
  //t.is(`1.235${ThinSpace}cm`, formatNumberToLength(1.23456789, LengthUnit.cm, 3));
  //t.is(`1.2346${ThinSpace}cm²`, formatNumberToArea(1.23456789, LengthUnit.cm, 4));
  //t.is(`1.23457${ThinSpace}cm²`, formatNumberToArea(1.23456789, LengthUnit.cm, 5));
});*/
