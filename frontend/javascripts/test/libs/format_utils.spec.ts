import test from "ava";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";
import { Unicode, UnitShort } from "oxalis/constants";

const { ThinSpace } = Unicode;

test("Format number to length with cm", (t) => {
  t.is(`0.0${ThinSpace}cm`, formatNumberToLength(0, UnitShort.cm));
  t.is(`0.1${ThinSpace}cm`, formatNumberToLength(0.1, UnitShort.cm, 1, true));
  t.is(`1.0${ThinSpace}cm`, formatNumberToLength(10, UnitShort.mm));
  t.is(`4.8${ThinSpace}cm`, formatNumberToLength(48, UnitShort.mm));
  t.is(`1.6${ThinSpace}cm`, formatNumberToLength(16000, UnitShort.µm));
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(0.012, UnitShort.m));
});

test("Format number to area with cm", (t) => {
  t.is(`0.0${ThinSpace}cm²`, formatNumberToArea(0, UnitShort.cm));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(0.1, UnitShort.cm));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(10, UnitShort.mm));
  t.is(`1.0${ThinSpace}cm²`, formatNumberToArea(100, UnitShort.mm));
  t.is(`48.0${ThinSpace}mm²`, formatNumberToArea(48, UnitShort.mm));
  t.is(`16.0${ThinSpace}cm²`, formatNumberToArea(1600000000, UnitShort.µm));
  t.is(`1.2${ThinSpace}cm²`, formatNumberToArea(0.00012, UnitShort.m));
});

test("Format number to volume with cm", (t) => {
  t.is(`0.0${ThinSpace}cm³`, formatNumberToVolume(0, UnitShort.cm));
  t.is(`100.0${ThinSpace}mm³`, formatNumberToVolume(0.1, UnitShort.cm));
  t.is(`100.0${ThinSpace}mm³`, formatNumberToVolume(100, UnitShort.mm));
  t.is(`1.0${ThinSpace}cm³`, formatNumberToVolume(1000, UnitShort.mm));
  t.is(`4.8${ThinSpace}cm³`, formatNumberToVolume(4800, UnitShort.mm));
  t.is(`16.0${ThinSpace}cm³`, formatNumberToVolume(16e12, UnitShort.µm));
  t.is(`120.0${ThinSpace}cm³`, formatNumberToVolume(0.00012, UnitShort.m));
});

test("Format conversion in length", (t) => {
  t.is(`1.2${ThinSpace}pm`, formatNumberToLength(0.0012, UnitShort.nm));
  t.is(`12.0${ThinSpace}fm`, formatNumberToLength(0.000012, UnitShort.nm));
  t.is(`1.2${ThinSpace}mm`, formatNumberToLength(1.2e6, UnitShort.nm));
  t.is(`12.0${ThinSpace}nm`, formatNumberToLength(12, UnitShort.nm));
  t.is(`10.0${ThinSpace}fm`, formatNumberToLength(1e-5, UnitShort.nm));
  t.is(`0.0${ThinSpace}ym`, formatNumberToLength(1e-17, UnitShort.nm));
  t.is(`1.2${ThinSpace}Mm`, formatNumberToLength(1234e12, UnitShort.nm));
  t.is(`1234.0${ThinSpace}Ym`, formatNumberToLength(1234e33, UnitShort.nm));
});

test("Format number to area", (t) => {
  t.is(`100000.0${ThinSpace}fm²`, formatNumberToArea(1e-7, UnitShort.nm));
  t.is(`0.0${ThinSpace}ym²`, formatNumberToArea(1e-33, UnitShort.nm));
  t.is(`12.0${ThinSpace}cm²`, formatNumberToArea(0.0012, UnitShort.m));
  t.is(`12.0${ThinSpace}mm²`, formatNumberToArea(0.000012, UnitShort.m));
  t.is(`1.0${ThinSpace}km²`, formatNumberToArea(1e6, UnitShort.m));
  t.is(`12.0${ThinSpace}m²`, formatNumberToArea(12, UnitShort.m));
  t.is(`10.0${ThinSpace}mm²`, formatNumberToArea(1e-5, UnitShort.m));
  t.is(`10.0${ThinSpace}nm²`, formatNumberToArea(1e-17, UnitShort.m));
  t.is(`1234.0${ThinSpace}Mm²`, formatNumberToArea(1234e12, UnitShort.m));
  t.is(`1.2${ThinSpace}Em²`, formatNumberToArea(1234e33, UnitShort.m));
});

test("Format number to volume", (t) => {
  t.is(`100000000.0${ThinSpace}pm³`, formatNumberToVolume(1e-1, UnitShort.nm));
  t.is(`1000.0${ThinSpace}zm³`, formatNumberToVolume(1e-33, UnitShort.nm));
  t.is(`1200.0${ThinSpace}cm³`, formatNumberToVolume(0.0012, UnitShort.m));
  t.is(`12.0${ThinSpace}cm³`, formatNumberToVolume(0.000012, UnitShort.m));
  t.is(`1000000.0${ThinSpace}m³`, formatNumberToVolume(1e6, UnitShort.m));
  t.is(`12.0${ThinSpace}m³`, formatNumberToVolume(12, UnitShort.m));
  t.is(`10.0${ThinSpace}cm³`, formatNumberToVolume(1e-5, UnitShort.m));
  t.is(`10.0${ThinSpace}µm³`, formatNumberToVolume(1e-17, UnitShort.m));
  t.is(`1234000.0${ThinSpace}km³`, formatNumberToVolume(1234e12, UnitShort.m));
  t.is(`1.2${ThinSpace}Tm³`, formatNumberToVolume(1234e33, UnitShort.m));
});

test("Test uncommon number formats", (t) => {
  t.is(`1.0${ThinSpace}m`, formatNumberToLength(10, UnitShort.dm, 2));
  t.is(`5500.0${ThinSpace}cm³`, formatNumberToVolume(5.5, UnitShort.dm, 2));
  t.is(`1.0${ThinSpace}km`, formatNumberToLength(10, UnitShort.hm, 2));
  t.is(`550.0${ThinSpace}m`, formatNumberToLength(5.5, UnitShort.hm, 2));
  t.is(`1.0${ThinSpace}nm`, formatNumberToLength(10, UnitShort.Å, 2));
  t.is(`55000.0${ThinSpace}pm²`, formatNumberToArea(5.5, UnitShort.Å, 2));
  t.is(`25.4${ThinSpace}cm`, formatNumberToLength(10, UnitShort.in, 2));
  t.is(`13.97${ThinSpace}cm`, formatNumberToLength(5.5, UnitShort.in, 2));
  t.is(`3.05${ThinSpace}m`, formatNumberToLength(10, UnitShort.ft, 2));
  t.is(`1.68${ThinSpace}m`, formatNumberToLength(5.5, UnitShort.ft, 2));
  t.is(`9.14${ThinSpace}m`, formatNumberToLength(10, UnitShort.yd, 2));
  t.is(`5.03${ThinSpace}m`, formatNumberToLength(5.5, UnitShort.yd, 2));
  t.is(`16.09${ThinSpace}km`, formatNumberToLength(10, UnitShort.mi, 2));
  t.is(`8.85${ThinSpace}km`, formatNumberToLength(5.5, UnitShort.mi, 2));
  t.is(`308.57${ThinSpace}Pm`, formatNumberToLength(10, UnitShort.pc, 2));
  t.is(`169.71${ThinSpace}Pm`, formatNumberToLength(5.5, UnitShort.pc, 2));
});

test("Test precision in formatting numbers", (t) => {
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(1.23456789, UnitShort.cm));
  t.is(`1.23${ThinSpace}cm`, formatNumberToLength(1.23456789, UnitShort.cm, 2));
  t.is(`1.235${ThinSpace}cm²`, formatNumberToArea(1.23456789, UnitShort.cm, 3));
  t.is(`1.2346${ThinSpace}cm²`, formatNumberToArea(1.23456789, UnitShort.cm, 4));
  t.is(`1.23457${ThinSpace}cm³`, formatNumberToVolume(1.23456789, UnitShort.cm, 5));
  t.is(`1.234568${ThinSpace}cm³`, formatNumberToVolume(1.23456789, UnitShort.cm, 6));
});

test("Test preferShorterDecimals in formatting numbers", (t) => {
  t.is(`0.1${ThinSpace}m`, formatNumberToLength(0.1, UnitShort.m, 1, true));
  t.is(`1.2${ThinSpace}cm`, formatNumberToLength(1.23456789, UnitShort.cm, 1, true));
  t.is(`0.3${ThinSpace}m`, formatNumberToLength(0.35, UnitShort.m, 1, true));
});

test("Test formatting cuts off trailing zeros", (t) => {
  t.is(`10.0${ThinSpace}cm`, formatNumberToLength(0.1, UnitShort.m, 3));
  t.is(`12.0${ThinSpace}cm`, formatNumberToLength(0.12, UnitShort.m, 3));
  t.is(`0.001${ThinSpace}km`, formatNumberToLength(1, UnitShort.m, 3, true));
});
