import { map3, maxValue, minValue } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { Vector3 } from "oxalis/constants";

export type SmallerOrHigherInfo = {
  smaller: boolean;
  higher: boolean;
};

export class MagInfo {
  readonly mags: ReadonlyArray<Vector3>;
  readonly magnificationMap: ReadonlyMap<number, Vector3>;

  constructor(mags: Array<Vector3>) {
    this.mags = mags;
    this.magnificationMap = this._buildMagnificationMap();
  }

  _buildMagnificationMap() {
    // Each resolution entry can be characterized by it's greatest resolution dimension.
    // E.g., the resolution array [[1, 1, 1], [2, 2, 1], [4, 4, 2]] defines that
    // a zoomstep of 2 corresponds to the resolution [2, 2, 1] (and not [4, 4, 2]).
    // Therefore, the largest dim for each resolution has to be unique across all resolutions.
    // This function creates a map which maps from powerOfTwo (2**index) to resolution.
    // E.g.
    // {
    //  0: [1, 1, 1],
    //  2: [2, 2, 1],
    //  4: [4, 4, 2]
    // }
    const { mags } = this;
    const magnificationMap = new Map();

    if (mags.length !== _.uniq(mags.map(maxValue)).length) {
      throw new Error("Max dimension in magnifications is not unique.");
    }

    for (const resolution of mags) {
      magnificationMap.set(maxValue(resolution), resolution);
    }
    return magnificationMap;
  }

  getDenseMags = memoizeOne(() => convertToDenseMag(this.getMagList()));

  getMagList = memoizeOne(() => Array.from(this.magnificationMap.values()));

  getMagsWithIndices(): Array<[number, Vector3]> {
    return _.sortBy(
      Array.from(this.magnificationMap.entries()).map((entry) => {
        const [powerOfTwo, resolution] = entry;
        const resolutionIndex = Math.log2(powerOfTwo);
        return [resolutionIndex, resolution];
      }), // Sort by resolutionIndex
      (tuple) => tuple[0],
    );
  }

  indexToPowerOf2(index: number): number {
    return 2 ** index;
  }

  hasIndex(index: number): boolean {
    const powerOfTwo = this.indexToPowerOf2(index);
    return this.magnificationMap.has(powerOfTwo);
  }

  hasMag(magnification: Vector3): boolean {
    return this.magnificationMap.has(Math.max(...magnification));
  }

  getMagByIndex(index: number): Vector3 | null | undefined {
    const powerOfTwo = this.indexToPowerOf2(index);
    return this.getMagByPowerOf2(powerOfTwo);
  }

  getMagByIndexOrThrow(index: number): Vector3 {
    const resolution = this.getMagByIndex(index);

    if (!resolution) {
      throw new Error(`Magnification with index ${index} does not exist.`);
    }

    return resolution;
  }

  getIndexByMag(magnification: Vector3): number {
    const index = Math.log2(Math.max(...magnification));

    // Assert that the index exists and that the mag at that index
    // equals the mag argument
    const resolutionMaybe = this.getMagByIndex(index);
    if (!_.isEqual(magnification, resolutionMaybe)) {
      throw new Error(
        `Magnification ${magnification} with index ${index} is not equal to existing magnification at that index: ${resolutionMaybe}.`,
      );
    }
    return index;
  }

  getMagByIndexWithFallback(index: number, fallbackMagInfo: MagInfo | null | undefined): Vector3 {
    let resolutionMaybe = this.getMagByIndex(index);

    if (resolutionMaybe) {
      return resolutionMaybe;
    }

    resolutionMaybe = fallbackMagInfo != null ? fallbackMagInfo.getMagByIndex(index) : null;

    if (resolutionMaybe) {
      return resolutionMaybe;
    }

    if (index === 0) {
      // If the index is 0, only mag 1-1-1 can be meant.
      return [1, 1, 1];
    }

    throw new Error(`Magnification could not be determined for index ${index}`);
  }

  getMagByPowerOf2(powerOfTwo: number): Vector3 | null | undefined {
    return this.magnificationMap.get(powerOfTwo);
  }

  getCoarsestMagPowerOf2(): number {
    return maxValue(Array.from(this.magnificationMap.keys()));
  }

  getFinestMagPowerOf2(): number {
    return minValue(Array.from(this.magnificationMap.keys()));
  }

  getCoarsestMagIndex(): number {
    return Math.log2(this.getCoarsestMagPowerOf2());
  }

  getFinestMagIndex(): number {
    return Math.log2(this.getFinestMagPowerOf2());
  }

  getCoarsestMag(): Vector3 {
    // @ts-ignore
    return this.getMagByPowerOf2(this.getCoarsestMagPowerOf2());
  }

  getFinestMag(): Vector3 {
    // @ts-ignore
    return this.getMagByPowerOf2(this.getFinestMagPowerOf2());
  }

  getAllIndices(): Array<number> {
    return this.getMagsWithIndices().map((entry) => entry[0]);
  }

  getClosestExistingIndex(index: number, errorMessage: string | null = null): number {
    if (this.hasIndex(index)) {
      return index;
    }

    const indices = this.getAllIndices();
    const indicesWithDistances = indices.map((_index) => {
      const distance = index - _index;

      if (distance >= 0) {
        // The candidate _index is smaller than the requested index.
        // Since webKnossos only supports rendering from higher mags,
        // when a mag is missing, we want to prioritize "higher" mags
        // when looking for a substitute. Therefore, we artificially
        // downrank the smaller mag _index.
        return [_index, distance + 0.5];
      } else {
        return [_index, Math.abs(distance)];
      }
    });

    const bestIndexWithDistance = _.head(_.sortBy(indicesWithDistances, (entry) => entry[1]));
    if (bestIndexWithDistance == null) {
      throw new Error(errorMessage || "Couldn't find any magnification.");
    }

    return bestIndexWithDistance[0];
  }

  getClosestExistingMag(magnification: Vector3): Vector3 {
    const index = Math.log2(Math.max(...magnification));
    return this.getMagByIndex(this.getClosestExistingIndex(index)) as Vector3;
  }

  hasSmallerAndOrHigherIndex(index: number): SmallerOrHigherInfo {
    const indices = this.getAllIndices();
    const hasSmallOrHigher = {
      smaller: false,
      higher: false,
    };

    for (const currentIndex of indices) {
      if (currentIndex < index) {
        hasSmallOrHigher.smaller = true;
      } else if (currentIndex > index) {
        hasSmallOrHigher.higher = true;
      }
    }

    return hasSmallOrHigher;
  }

  getIndexOrClosestHigherIndex(requestedIndex: number): number | null | undefined {
    if (this.hasIndex(requestedIndex)) {
      return requestedIndex;
    }

    const indices = this.getMagsWithIndices().map((entry) => entry[0]);

    for (const index of indices) {
      if (index > requestedIndex) {
        // Return the first existing index which is higher than the requestedIndex
        return index;
      }
    }

    return null;
  }
}

export function convertToDenseMag(magnifications: Array<Vector3>): Array<Vector3> {
  // Each magnification entry can be characterized by it's greatest mag dimension.
  // E.g., the mag array [[1, 1, 1], [2, 2, 1], [4, 4, 2]] defines that
  // a log zoomstep of 2 corresponds to the mag [2, 2, 1] (and not [4, 4, 2]).
  // Therefore, the largest dim for each mag has to be unique across all mags.
  // This function returns an array of mags, for which each index will
  // hold a mag with highest_dim === 2**index and where mags are monotonously increasing.

  if (magnifications.length !== _.uniq(magnifications.map(maxValue)).length) {
    throw new Error("Max dimension in magnifications is not unique.");
  }

  const maxResolution = Math.log2(maxValue(magnifications.map((v) => maxValue(v))));

  const resolutionsLookUp = _.keyBy(magnifications, maxValue);

  const maxResPower = 2 ** maxResolution;
  let lastResolution = [maxResPower, maxResPower, maxResPower];

  return _.range(maxResolution, -1, -1)
    .map((exp) => {
      const resPower = 2 ** exp;
      // If the magnification does not exist, use the component-wise minimum of the next-higher
      // mag and an isotropic fallback mag. Otherwise for anisotropic mags,
      // the dense mags wouldn't be monotonously increasing.
      const fallback = map3((i) => Math.min(lastResolution[i], resPower), [0, 1, 2]);
      lastResolution = resolutionsLookUp[resPower] || fallback;
      return lastResolution as Vector3;
    })
    .reverse();
}
