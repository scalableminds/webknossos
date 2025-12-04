import { describe, it, expect } from "vitest";
import { UnitShort, Unicode } from "viewer/constants";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";

const { ThinSpace } = Unicode;

describe("Format Utils", () => {
  it("Format number to length with cm", () => {
    expect(`0.0${ThinSpace}cm`).toBe(formatNumberToLength(0, UnitShort.cm));
    expect(`0.1${ThinSpace}cm`).toBe(formatNumberToLength(0.1, UnitShort.cm, 1, true));
    expect(`1.0${ThinSpace}cm`).toBe(formatNumberToLength(10, UnitShort.mm));
    expect(`4.8${ThinSpace}cm`).toBe(formatNumberToLength(48, UnitShort.mm));
    expect(`1.6${ThinSpace}cm`).toBe(formatNumberToLength(16000, UnitShort.µm));
    expect(`1.2${ThinSpace}cm`).toBe(formatNumberToLength(0.012, UnitShort.m));
  });

  it("Format number to area with cm", () => {
    expect(`0.0${ThinSpace}cm²`).toBe(formatNumberToArea(0, UnitShort.cm));
    expect(`10.0${ThinSpace}mm²`).toBe(formatNumberToArea(0.1, UnitShort.cm));
    expect(`10.0${ThinSpace}mm²`).toBe(formatNumberToArea(10, UnitShort.mm));
    expect(`1.0${ThinSpace}cm²`).toBe(formatNumberToArea(100, UnitShort.mm));
    expect(`48.0${ThinSpace}mm²`).toBe(formatNumberToArea(48, UnitShort.mm));
    expect(`16.0${ThinSpace}cm²`).toBe(formatNumberToArea(1600000000, UnitShort.µm));
    expect(`1.2${ThinSpace}cm²`).toBe(formatNumberToArea(0.00012, UnitShort.m));
  });

  it("Format number to volume with cm", () => {
    expect(`0.0${ThinSpace}cm³`).toBe(formatNumberToVolume(0, UnitShort.cm));
    expect(`100.0${ThinSpace}mm³`).toBe(formatNumberToVolume(0.1, UnitShort.cm));
    expect(`100.0${ThinSpace}mm³`).toBe(formatNumberToVolume(100, UnitShort.mm));
    expect(`1.0${ThinSpace}cm³`).toBe(formatNumberToVolume(1000, UnitShort.mm));
    expect(`4.8${ThinSpace}cm³`).toBe(formatNumberToVolume(4800, UnitShort.mm));
    expect(`16.0${ThinSpace}cm³`).toBe(formatNumberToVolume(16e12, UnitShort.µm));
    expect(`120.0${ThinSpace}cm³`).toBe(formatNumberToVolume(0.00012, UnitShort.m));
  });

  it("Format conversion in length", () => {
    expect(`1.2${ThinSpace}pm`).toBe(formatNumberToLength(0.0012, UnitShort.nm));
    expect(`12.0${ThinSpace}fm`).toBe(formatNumberToLength(0.000012, UnitShort.nm));
    expect(`1.2${ThinSpace}mm`).toBe(formatNumberToLength(1.2e6, UnitShort.nm));
    expect(`12.0${ThinSpace}nm`).toBe(formatNumberToLength(12, UnitShort.nm));
    expect(`10.0${ThinSpace}fm`).toBe(formatNumberToLength(1e-5, UnitShort.nm));
    expect(`0.0${ThinSpace}ym`).toBe(formatNumberToLength(1e-17, UnitShort.nm));
    expect(`1.2${ThinSpace}Mm`).toBe(formatNumberToLength(1234e12, UnitShort.nm));
    expect(`1234.0${ThinSpace}Ym`).toBe(formatNumberToLength(1234e33, UnitShort.nm));
  });

  it("Format number to area", () => {
    expect(`100000.0${ThinSpace}fm²`).toBe(formatNumberToArea(1e-7, UnitShort.nm));
    expect(`0.0${ThinSpace}ym²`).toBe(formatNumberToArea(1e-33, UnitShort.nm));
    expect(`12.0${ThinSpace}cm²`).toBe(formatNumberToArea(0.0012, UnitShort.m));
    expect(`12.0${ThinSpace}mm²`).toBe(formatNumberToArea(0.000012, UnitShort.m));
    expect(`1.0${ThinSpace}km²`).toBe(formatNumberToArea(1e6, UnitShort.m));
    expect(`12.0${ThinSpace}m²`).toBe(formatNumberToArea(12, UnitShort.m));
    expect(`10.0${ThinSpace}mm²`).toBe(formatNumberToArea(1e-5, UnitShort.m));
    expect(`10.0${ThinSpace}nm²`).toBe(formatNumberToArea(1e-17, UnitShort.m));
    expect(`1234.0${ThinSpace}Mm²`).toBe(formatNumberToArea(1234e12, UnitShort.m));
    expect(`1.2${ThinSpace}Em²`).toBe(formatNumberToArea(1234e33, UnitShort.m));
  });

  it("Format number to volume", () => {
    expect(`100000000.0${ThinSpace}pm³`).toBe(formatNumberToVolume(1e-1, UnitShort.nm));
    expect(`1000.0${ThinSpace}zm³`).toBe(formatNumberToVolume(1e-33, UnitShort.nm));
    expect(`1200.0${ThinSpace}cm³`).toBe(formatNumberToVolume(0.0012, UnitShort.m));
    expect(`12.0${ThinSpace}cm³`).toBe(formatNumberToVolume(0.000012, UnitShort.m));
    expect(`1000000.0${ThinSpace}m³`).toBe(formatNumberToVolume(1e6, UnitShort.m));
    expect(`12.0${ThinSpace}m³`).toBe(formatNumberToVolume(12, UnitShort.m));
    expect(`10.0${ThinSpace}cm³`).toBe(formatNumberToVolume(1e-5, UnitShort.m));
    expect(`10.0${ThinSpace}µm³`).toBe(formatNumberToVolume(1e-17, UnitShort.m));
    expect(`1234000.0${ThinSpace}km³`).toBe(formatNumberToVolume(1234e12, UnitShort.m));
    expect(`1.2${ThinSpace}Tm³`).toBe(formatNumberToVolume(1234e33, UnitShort.m));
  });

  it("Test uncommon number formats", () => {
    expect(`1.0${ThinSpace}m`).toBe(formatNumberToLength(10, UnitShort.dm, 2));
    expect(`5500.0${ThinSpace}cm³`).toBe(formatNumberToVolume(5.5, UnitShort.dm, 2));
    expect(`1.0${ThinSpace}km`).toBe(formatNumberToLength(10, UnitShort.hm, 2));
    expect(`550.0${ThinSpace}m`).toBe(formatNumberToLength(5.5, UnitShort.hm, 2));
    expect(`1.0${ThinSpace}nm`).toBe(formatNumberToLength(10, UnitShort.Å, 2));
    expect(`55000.0${ThinSpace}pm²`).toBe(formatNumberToArea(5.5, UnitShort.Å, 2));
    expect(`25.4${ThinSpace}cm`).toBe(formatNumberToLength(10, UnitShort.in, 2));
    expect(`13.97${ThinSpace}cm`).toBe(formatNumberToLength(5.5, UnitShort.in, 2));
    expect(`3.05${ThinSpace}m`).toBe(formatNumberToLength(10, UnitShort.ft, 2));
    expect(`1.68${ThinSpace}m`).toBe(formatNumberToLength(5.5, UnitShort.ft, 2));
    expect(`9.14${ThinSpace}m`).toBe(formatNumberToLength(10, UnitShort.yd, 2));
    expect(`5.03${ThinSpace}m`).toBe(formatNumberToLength(5.5, UnitShort.yd, 2));
    expect(`16.09${ThinSpace}km`).toBe(formatNumberToLength(10, UnitShort.mi, 2));
    expect(`8.85${ThinSpace}km`).toBe(formatNumberToLength(5.5, UnitShort.mi, 2));
    expect(`308.57${ThinSpace}Pm`).toBe(formatNumberToLength(10, UnitShort.pc, 2));
    expect(`169.71${ThinSpace}Pm`).toBe(formatNumberToLength(5.5, UnitShort.pc, 2));
  });

  it("Test precision in formatting numbers", () => {
    expect(`1.2${ThinSpace}cm`).toBe(formatNumberToLength(1.23456789, UnitShort.cm));
    expect(`1.23${ThinSpace}cm`).toBe(formatNumberToLength(1.23456789, UnitShort.cm, 2));
    expect(`1.235${ThinSpace}cm²`).toBe(formatNumberToArea(1.23456789, UnitShort.cm, 3));
    expect(`1.2346${ThinSpace}cm²`).toBe(formatNumberToArea(1.23456789, UnitShort.cm, 4));
    expect(`1.23457${ThinSpace}cm³`).toBe(formatNumberToVolume(1.23456789, UnitShort.cm, 5));
    expect(`1.234568${ThinSpace}cm³`).toBe(formatNumberToVolume(1.23456789, UnitShort.cm, 6));
  });

  it("Test preferShorterDecimals in formatting numbers", () => {
    expect(`0.1${ThinSpace}m`).toBe(formatNumberToLength(0.1, UnitShort.m, 1, true));
    expect(`1.2${ThinSpace}cm`).toBe(formatNumberToLength(1.23456789, UnitShort.cm, 1, true));
    expect(`0.3${ThinSpace}m`).toBe(formatNumberToLength(0.35, UnitShort.m, 1, true));
  });

  it("Test formatting cuts off trailing zeros", () => {
    expect(`10.0${ThinSpace}cm`).toBe(formatNumberToLength(0.1, UnitShort.m, 3));
    expect(`12.0${ThinSpace}cm`).toBe(formatNumberToLength(0.12, UnitShort.m, 3));
    expect(`0.001${ThinSpace}km`).toBe(formatNumberToLength(1, UnitShort.m, 3, true));
  });
});
