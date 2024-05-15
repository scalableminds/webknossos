import test from "ava";
import _ from "lodash";
import { Unit, Unicode } from "oxalis/constants";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";

const { ThinSpace } = Unicode;

test("Format number to length with cm", (t) => {
  t.is(`0.0${ThinSpace}cm`, formatNumberToLength(0, Unit.cm));
  t.is(`0.1${ThinSpace}cm`, formatNumberToLength(0.1, Unit.cm, 1, true));
  t.is(`1.0${ThinSpace}cm`, formatNumberToLength(10, Unit.mm));
  t.is(`4.8${ThinSpace}cm`, formatNumberToLength(48, Unit.mm));
  t.is(`1.6${ThinSpace}cm`, formatNumberToLength(16000, Unit.µm));
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(0.012, Unit.m));
});

test("Format number to area with cm", (t) => {
  t.is(`0.0${ThinSpace}cm²`, formatNumberToArea(0, Unit.cm));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(0.1, Unit.cm));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(10, Unit.mm));
  t.is(`1.0${ThinSpace}cm²`, formatNumberToArea(100, Unit.mm));
  t.is(`48.0${ThinSpace}mm²`, formatNumberToArea(48, Unit.mm));
  t.is(`16.0${ThinSpace}cm²`, formatNumberToArea(1600000000, Unit.µm));
  t.is(`1.2${ThinSpace}cm²`, formatNumberToArea(0.00012, Unit.m));
});

test("Format number to volume with cm", (t) => {
  t.is(`0.0${ThinSpace}cm³`, formatNumberToVolume(0, Unit.cm));
  t.is(`100.0${ThinSpace}mm³`, formatNumberToVolume(0.1, Unit.cm));
  t.is(`100.0${ThinSpace}mm³`, formatNumberToVolume(100, Unit.mm));
  t.is(`1.0${ThinSpace}cm³`, formatNumberToVolume(1000, Unit.mm));
  t.is(`4.8${ThinSpace}cm³`, formatNumberToVolume(4800, Unit.mm));
  t.is(`16.0${ThinSpace}cm³`, formatNumberToVolume(16e12, Unit.µm));
  t.is(`120.0${ThinSpace}cm³`, formatNumberToVolume(0.00012, Unit.m));
});

test("Format conversion in length", (t) => {
  t.is(`1.2${ThinSpace}pm`, formatNumberToLength(0.0012, Unit.nm));
  t.is(`12.0${ThinSpace}fm`, formatNumberToLength(0.000012, Unit.nm));
  t.is(`1.2${ThinSpace}mm`, formatNumberToLength(1.2e6, Unit.nm));
  t.is(`12.0${ThinSpace}nm`, formatNumberToLength(12, Unit.nm));
  t.is(`10.0${ThinSpace}fm`, formatNumberToLength(1e-5, Unit.nm));
  t.is(`0.0${ThinSpace}ym`, formatNumberToLength(1e-17, Unit.nm));
  t.is(`1.2${ThinSpace}Mm`, formatNumberToLength(1234e12, Unit.nm));
  t.is(`1234.0${ThinSpace}Ym`, formatNumberToLength(1234e33, Unit.nm));
});

test("Format number to area", (t) => {
  t.is(`100000.0${ThinSpace}fm²`, formatNumberToArea(1e-7, Unit.nm));
  t.is(`0.0${ThinSpace}ym²`, formatNumberToArea(1e-33, Unit.nm));
  t.is(`12.0${ThinSpace}cm²`, formatNumberToArea(0.0012, Unit.m));
  t.is(`12.0${ThinSpace}mm²`, formatNumberToArea(0.000012, Unit.m));
  t.is(`1.0${ThinSpace}km²`, formatNumberToArea(1e6, Unit.m));
  t.is(`12.0${ThinSpace}m²`, formatNumberToArea(12, Unit.m));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(1e-5, Unit.m));
  t.is(`10.0${ThinSpace}nm²`, formatNumberToArea(1e-17, Unit.m));
  t.is(`1234.0${ThinSpace}Mm²`, formatNumberToArea(1234e12, Unit.m));
  t.is(`1.2${ThinSpace}Em²`, formatNumberToArea(1234e33, Unit.m));
});

test("Format number to volume", (t) => {
  t.is(`100000000.0${ThinSpace}pm³`, formatNumberToVolume(1e-1, Unit.nm));
  t.is(`1000.0${ThinSpace}zm³`, formatNumberToVolume(1e-33, Unit.nm));
  t.is(`1200.0${ThinSpace}cm³`, formatNumberToVolume(0.0012, Unit.m));
  t.is(`12.0${ThinSpace}cm³`, formatNumberToVolume(0.000012, Unit.m));
  t.is(`1000000.0${ThinSpace}m³`, formatNumberToVolume(1e6, Unit.m));
  t.is(`12.0${ThinSpace}m³`, formatNumberToVolume(12, Unit.m));
  t.is(`10.0${ThinSpace}cm³`, formatNumberToVolume(1e-5, Unit.m));
  t.is(`10.0${ThinSpace}µm³`, formatNumberToVolume(1e-17, Unit.m));
  t.is(`1234000.0${ThinSpace}km³`, formatNumberToVolume(1234e12, Unit.m));
  t.is(`1.2${ThinSpace}Tm³`, formatNumberToVolume(1234e33, Unit.m));
});

test("Test uncommon number formats", (t) => {
  t.is(`1.0${ThinSpace}m`, formatNumberToLength(10, Unit.dm, 2));
  t.is(`5500.0${ThinSpace}cm³`, formatNumberToVolume(5.5, Unit.dm, 2));
  t.is(`1.0${ThinSpace}km`, formatNumberToLength(10, Unit.hm, 2));
  t.is(`550.0${ThinSpace}m`, formatNumberToLength(5.5, Unit.hm, 2));
  t.is(`1.0${ThinSpace}nm`, formatNumberToLength(10, Unit.Å, 2));
  t.is(`55000.0${ThinSpace}pm²`, formatNumberToArea(5.5, Unit.Å, 2));
  t.is(`25.4${ThinSpace}cm`, formatNumberToLength(10, Unit.in, 2));
  t.is(`13.97${ThinSpace}cm`, formatNumberToLength(5.5, Unit.in, 2));
  t.is(`3.05${ThinSpace}m`, formatNumberToLength(10, Unit.ft, 2));
  t.is(`1.68${ThinSpace}m`, formatNumberToLength(5.5, Unit.ft, 2));
  t.is(`9.14${ThinSpace}m`, formatNumberToLength(10, Unit.yd, 2));
  t.is(`5.03${ThinSpace}m`, formatNumberToLength(5.5, Unit.yd, 2));
  t.is(`16.09${ThinSpace}km`, formatNumberToLength(10, Unit.mi, 2));
  t.is(`8.85${ThinSpace}km`, formatNumberToLength(5.5, Unit.mi, 2));
  t.is(`308.57${ThinSpace}Pm`, formatNumberToLength(10, Unit.pc, 2));
  t.is(`169.71${ThinSpace}Pm`, formatNumberToLength(5.5, Unit.pc, 2));
});

test("Test precision in formatting numbers", (t) => {
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(1.23456789, Unit.cm));
  t.is(`1.23${ThinSpace}cm`, formatNumberToLength(1.23456789, Unit.cm, 2));
  t.is(`1.235${ThinSpace}cm²`, formatNumberToArea(1.23456789, Unit.cm, 3));
  t.is(`1.2346${ThinSpace}cm²`, formatNumberToArea(1.23456789, Unit.cm, 4));
  t.is(`1.23457${ThinSpace}cm³`, formatNumberToVolume(1.23456789, Unit.cm, 5));
  t.is(`1.234568${ThinSpace}cm³`, formatNumberToVolume(1.23456789, Unit.cm, 6));
});

test("Test preferShorterDecimals in formatting numbers", (t) => {
  t.is(`0.1${ThinSpace}m`, formatNumberToLength(0.1, Unit.m, 1, true));
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(1.23456789, Unit.cm, 1, true));
  t.is(`0.3${ThinSpace}m`, formatNumberToLength(0.35, Unit.m, 1, true));
});

test("Test formatting cuts off trailing zeros", (t) => {
  t.is(`10.0${ThinSpace}cm`, formatNumberToLength(0.1, Unit.m, 3));
  t.is(`12.0${ThinSpace}cm`, formatNumberToLength(0.12, Unit.m, 3));
  t.is(`0.001${ThinSpace}km`, formatNumberToLength(1, Unit.m, 3, true));
});
