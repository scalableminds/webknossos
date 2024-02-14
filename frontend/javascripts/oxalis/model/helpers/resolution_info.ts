import { map3, maxValue, minValue } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { Vector3 } from "oxalis/constants";

export type SmallerOrHigherInfo = {
  smaller: boolean;
  higher: boolean;
};

export class ResolutionInfo {
  readonly resolutions: ReadonlyArray<Vector3>;
  readonly resolutionMap: ReadonlyMap<number, Vector3>;

  constructor(resolutions: Array<Vector3>) {
    this.resolutions = resolutions;
    this.resolutionMap = this._buildResolutionMap();
  }

  _buildResolutionMap() {
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
    const { resolutions } = this;
    const resolutionMap = new Map();

    if (resolutions.length !== _.uniq(resolutions.map(maxValue)).length) {
      throw new Error("Max dimension in resolutions is not unique.");
    }

    for (const resolution of resolutions) {
      resolutionMap.set(maxValue(resolution), resolution);
    }
    return resolutionMap;
  }

  getDenseResolutions = memoizeOne(() => convertToDenseResolution(this.getResolutionList()));

  getResolutionList = memoizeOne(() => Array.from(this.resolutionMap.values()));

  getResolutionsWithIndices(): Array<[number, Vector3]> {
    return _.sortBy(
      Array.from(this.resolutionMap.entries()).map((entry) => {
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
    return this.resolutionMap.has(powerOfTwo);
  }

  hasResolution(resolution: Vector3): boolean {
    return this.resolutionMap.has(Math.max(...resolution));
  }

  getResolutionByIndex(index: number): Vector3 | null | undefined {
    const powerOfTwo = this.indexToPowerOf2(index);
    return this.getResolutionByPowerOf2(powerOfTwo);
  }

  getResolutionByIndexOrThrow(index: number): Vector3 {
    const resolution = this.getResolutionByIndex(index);

    if (!resolution) {
      throw new Error(`Magnification with index ${index} does not exist.`);
    }

    return resolution;
  }

  getIndexByResolution(resolution: Vector3): number {
    const index = Math.log2(Math.max(...resolution));

    // Assert that the index exists and that the resolution at that index
    // equals the resolution argument
    const resolutionMaybe = this.getResolutionByIndex(index);
    if (!_.isEqual(resolution, resolutionMaybe)) {
      throw new Error(
        `Magnification ${resolution} with index ${index} is not equal to existing magnification at that index: ${resolutionMaybe}.`,
      );
    }
    return index;
  }

  getResolutionByIndexWithFallback(
    index: number,
    fallbackResolutionInfo: ResolutionInfo | null | undefined,
  ): Vector3 {
    let resolutionMaybe = this.getResolutionByIndex(index);

    if (resolutionMaybe) {
      return resolutionMaybe;
    }

    resolutionMaybe =
      fallbackResolutionInfo != null ? fallbackResolutionInfo.getResolutionByIndex(index) : null;

    if (resolutionMaybe) {
      return resolutionMaybe;
    }

    if (index === 0) {
      // If the index is 0, only mag 1-1-1 can be meant.
      return [1, 1, 1];
    }

    throw new Error(`Magnification could not be determined for index ${index}`);
  }

  getResolutionByPowerOf2(powerOfTwo: number): Vector3 | null | undefined {
    return this.resolutionMap.get(powerOfTwo);
  }

  getCoarsestResolutionPowerOf2(): number {
    return maxValue(Array.from(this.resolutionMap.keys()));
  }

  getFinestResolutionPowerOf2(): number {
    return minValue(Array.from(this.resolutionMap.keys()));
  }

  getCoarsestResolutionIndex(): number {
    return Math.log2(this.getCoarsestResolutionPowerOf2());
  }

  getFinestResolutionIndex(): number {
    return Math.log2(this.getFinestResolutionPowerOf2());
  }

  getCoarsestResolution(): Vector3 {
    // @ts-ignore
    return this.getResolutionByPowerOf2(this.getCoarsestResolutionPowerOf2());
  }

  getFinestResolution(): Vector3 {
    // @ts-ignore
    return this.getResolutionByPowerOf2(this.getFinestResolutionPowerOf2());
  }

  getAllIndices(): Array<number> {
    return this.getResolutionsWithIndices().map((entry) => entry[0]);
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
      throw new Error(errorMessage || "Couldn't find any resolution.");
    }

    return bestIndexWithDistance[0];
  }

  getClosestExistingResolution(resolution: Vector3): Vector3 {
    const index = Math.log2(Math.max(...resolution));
    return this.getResolutionByIndex(this.getClosestExistingIndex(index)) as Vector3;
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

    const indices = this.getResolutionsWithIndices().map((entry) => entry[0]);

    for (const index of indices) {
      if (index > requestedIndex) {
        // Return the first existing index which is higher than the requestedIndex
        return index;
      }
    }

    return null;
  }
}

export function convertToDenseResolution(resolutions: Array<Vector3>): Array<Vector3> {
  // Each resolution entry can be characterized by it's greatest resolution dimension.
  // E.g., the resolution array [[1, 1, 1], [2, 2, 1], [4, 4, 2]] defines that
  // a log zoomstep of 2 corresponds to the resolution [2, 2, 1] (and not [4, 4, 2]).
  // Therefore, the largest dim for each resolution has to be unique across all resolutions.
  // This function returns an array of resolutions, for which each index will
  // hold a resolution with highest_dim === 2**index and where resolutions are monotonously increasing.

  if (resolutions.length !== _.uniq(resolutions.map(maxValue)).length) {
    throw new Error("Max dimension in resolutions is not unique.");
  }

  const maxResolution = Math.log2(maxValue(resolutions.map((v) => maxValue(v))));

  const resolutionsLookUp = _.keyBy(resolutions, maxValue);

  const maxResPower = 2 ** maxResolution;
  let lastResolution = [maxResPower, maxResPower, maxResPower];

  return _.range(maxResolution, -1, -1)
    .map((exp) => {
      const resPower = 2 ** exp;
      // If the resolution does not exist, use the component-wise minimum of the next-higher
      // resolution and an isotropic fallback resolution. Otherwise for anisotropic resolutions,
      // the dense resolutions wouldn't be monotonously increasing.
      const fallback = map3((i) => Math.min(lastResolution[i], resPower), [0, 1, 2]);
      lastResolution = resolutionsLookUp[resPower] || fallback;
      return lastResolution as Vector3;
    })
    .reverse();
}
