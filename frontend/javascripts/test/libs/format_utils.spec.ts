import test from "ava";
import _ from "lodash";
import { LengthUnit, Unicode } from "oxalis/constants";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";

const { ThinSpace } = Unicode;

test("Format number to length with cm", (t) => {
  t.is(`0.0${ThinSpace}cm`, formatNumberToLength(0, LengthUnit.cm));
  t.is(`0.1${ThinSpace}cm`, formatNumberToLength(0.1, LengthUnit.cm, 1, true));
  t.is(`1.0${ThinSpace}cm`, formatNumberToLength(10, LengthUnit.mm));
  t.is(`4.8${ThinSpace}cm`, formatNumberToLength(48, LengthUnit.mm));
  t.is(`1.6${ThinSpace}cm`, formatNumberToLength(16000, LengthUnit.µm));
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(0.012, LengthUnit.m));
});

test("Format number to area with cm", (t) => {
  t.is(`0.0${ThinSpace}cm²`, formatNumberToArea(0, LengthUnit.cm));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(0.1, LengthUnit.cm));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(10, LengthUnit.mm));
  t.is(`1.0${ThinSpace}cm²`, formatNumberToArea(100, LengthUnit.mm));
  t.is(`48.0${ThinSpace}mm²`, formatNumberToArea(48, LengthUnit.mm));
  t.is(`16.0${ThinSpace}cm²`, formatNumberToArea(1600000000, LengthUnit.µm));
  t.is(`1.2${ThinSpace}cm²`, formatNumberToArea(0.00012, LengthUnit.m));
});

test("Format number to volume with cm", (t) => {
  t.is(`0.0${ThinSpace}cm³`, formatNumberToVolume(0, LengthUnit.cm));
  t.is(`100.0${ThinSpace}mm³`, formatNumberToVolume(0.1, LengthUnit.cm));
  t.is(`100.0${ThinSpace}mm³`, formatNumberToVolume(100, LengthUnit.mm));
  t.is(`1.0${ThinSpace}cm³`, formatNumberToVolume(1000, LengthUnit.mm));
  t.is(`4.8${ThinSpace}cm³`, formatNumberToVolume(4800, LengthUnit.mm));
  t.is(`16.0${ThinSpace}cm³`, formatNumberToVolume(16e12, LengthUnit.µm));
  t.is(`120.0${ThinSpace}cm³`, formatNumberToVolume(0.00012, LengthUnit.m));
});

test("Format conversion in length", (t) => {
  t.is(`1.2${ThinSpace}pm`, formatNumberToLength(0.0012, LengthUnit.nm));
  t.is(`12.0${ThinSpace}fm`, formatNumberToLength(0.000012, LengthUnit.nm));
  t.is(`1.2${ThinSpace}mm`, formatNumberToLength(1.2e6, LengthUnit.nm));
  t.is(`12.0${ThinSpace}nm`, formatNumberToLength(12, LengthUnit.nm));
  t.is(`10.0${ThinSpace}fm`, formatNumberToLength(1e-5, LengthUnit.nm));
  t.is(`0.0${ThinSpace}ym`, formatNumberToLength(1e-17, LengthUnit.nm));
  t.is(`1.2${ThinSpace}Mm`, formatNumberToLength(1234e12, LengthUnit.nm));
  t.is(`1234.0${ThinSpace}Ym`, formatNumberToLength(1234e33, LengthUnit.nm));
});

test("Format number to area", (t) => {
  t.is(`100000.0${ThinSpace}fm²`, formatNumberToArea(1e-7, LengthUnit.nm));
  t.is(`0.0${ThinSpace}ym²`, formatNumberToArea(1e-33, LengthUnit.nm));
  t.is(`12.0${ThinSpace}cm²`, formatNumberToArea(0.0012, LengthUnit.m));
  t.is(`12.0${ThinSpace}mm²`, formatNumberToArea(0.000012, LengthUnit.m));
  t.is(`1.0${ThinSpace}km²`, formatNumberToArea(1e6, LengthUnit.m));
  t.is(`12.0${ThinSpace}m²`, formatNumberToArea(12, LengthUnit.m));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(1e-5, LengthUnit.m));
  t.is(`10.0${ThinSpace}nm²`, formatNumberToArea(1e-17, LengthUnit.m));
  t.is(`1234.0${ThinSpace}Mm²`, formatNumberToArea(1234e12, LengthUnit.m));
  t.is(`1.2${ThinSpace}Em²`, formatNumberToArea(1234e33, LengthUnit.m));
});

test("Format number to volume", (t) => {
  t.is(`100000000.0${ThinSpace}pm³`, formatNumberToVolume(1e-1, LengthUnit.nm));
  t.is(`1000.0${ThinSpace}zm³`, formatNumberToVolume(1e-33, LengthUnit.nm));
  t.is(`1200.0${ThinSpace}cm³`, formatNumberToVolume(0.0012, LengthUnit.m));
  t.is(`12.0${ThinSpace}cm³`, formatNumberToVolume(0.000012, LengthUnit.m));
  t.is(`1000000.0${ThinSpace}m³`, formatNumberToVolume(1e6, LengthUnit.m));
  t.is(`12.0${ThinSpace}m³`, formatNumberToVolume(12, LengthUnit.m));
  t.is(`10.0${ThinSpace}cm³`, formatNumberToVolume(1e-5, LengthUnit.m));
  t.is(`10.0${ThinSpace}µm³`, formatNumberToVolume(1e-17, LengthUnit.m));
  t.is(`1234000.0${ThinSpace}km³`, formatNumberToVolume(1234e12, LengthUnit.m));
  t.is(`1.2${ThinSpace}Tm³`, formatNumberToVolume(1234e33, LengthUnit.m));
});

test("Test uncommon number formats", (t) => {
  t.is(`1.0${ThinSpace}m`, formatNumberToLength(10, LengthUnit.dm, 2));
  t.is(`55.0${ThinSpace}cm`, formatNumberToLength(5.5, LengthUnit.dm, 2));
  t.is(`1.0${ThinSpace}km`, formatNumberToLength(10, LengthUnit.hm, 2));
  t.is(`550.0${ThinSpace}m`, formatNumberToLength(5.5, LengthUnit.hm, 2));
  t.is(`1.0${ThinSpace}nm`, formatNumberToLength(10, LengthUnit.Å, 2));
  t.is(`550.0${ThinSpace}pm`, formatNumberToLength(5.5, LengthUnit.Å, 2));
  t.is(`25.4${ThinSpace}cm`, formatNumberToLength(10, LengthUnit.in, 2));
  t.is(`13.97${ThinSpace}cm`, formatNumberToLength(5.5, LengthUnit.in, 2));
  t.is(`3.05${ThinSpace}m`, formatNumberToLength(10, LengthUnit.ft, 2));
  t.is(`1.68${ThinSpace}m`, formatNumberToLength(5.5, LengthUnit.ft, 2));
  t.is(`9.14${ThinSpace}m`, formatNumberToLength(10, LengthUnit.yd, 2));
  t.is(`5.03${ThinSpace}m`, formatNumberToLength(5.5, LengthUnit.yd, 2));
  t.is(`16.09${ThinSpace}km`, formatNumberToLength(10, LengthUnit.mi, 2));
  t.is(`8.85${ThinSpace}km`, formatNumberToLength(5.5, LengthUnit.mi, 2));
  t.is(`308.57${ThinSpace}Pm`, formatNumberToLength(10, LengthUnit.pc, 2));
  t.is(`169.71${ThinSpace}Pm`, formatNumberToLength(5.5, LengthUnit.pc, 2));
});

// TODO test precision and preferShorterDecimals
test("Test precision in formatting numbers", (t) => {
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(1.23456789, LengthUnit.cm));
  t.is(`1.23${ThinSpace}cm`, formatNumberToLength(1.23456789, LengthUnit.cm, 2));
  t.is(`1.235${ThinSpace}cm²`, formatNumberToArea(1.23456789, LengthUnit.cm, 3));
  t.is(`1.2346${ThinSpace}cm²`, formatNumberToArea(1.23456789, LengthUnit.cm, 4));
  t.is(`1.23457${ThinSpace}cm³`, formatNumberToVolume(1.23456789, LengthUnit.cm, 5));
  t.is(`1.234568${ThinSpace}cm³`, formatNumberToVolume(1.23456789, LengthUnit.cm, 6));
});

// TODO Write test to prefer shorter decimals in case of no precision loss: 0.1m stays 0.1 meter instead of 10 cm
test("Test preferShorterDecimals in formatting numbers", (t) => {
  t.is(`0.1${ThinSpace}m`, formatNumberToLength(0.1, LengthUnit.m, 1, true));
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(1.23456789, LengthUnit.cm, 1, true));
  t.is(`0.3${ThinSpace}m`, formatNumberToLength(0.35, LengthUnit.m, 1, true));
});

test("Test formatting cuts off trailing zeros", (t) => {
  t.is(`10.0${ThinSpace}cm`, formatNumberToLength(0.1, LengthUnit.m, 3));
  t.is(`12.0${ThinSpace}cm`, formatNumberToLength(0.12, LengthUnit.m, 3));
  t.is(`0.001${ThinSpace}km`, formatNumberToLength(1, LengthUnit.m, 3, true));
});

// TODO Write test to test trailing 0s are cut off: precision: 2 -> 1.0m stays 1.0m and not 1.00 meter
