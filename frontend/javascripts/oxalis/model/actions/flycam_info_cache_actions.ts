type SetMagRangeForLayerAction = ReturnType<typeof setMagRangeForLayerAction>;

export type FlycamInfoCacheAction = SetMagRangeForLayerAction;

export const setMagRangeForLayerAction = (layerName: string, magRange: number[]) =>
  ({
    type: "SET_MAG_RANGE_FOR_LAYER",
    layerName,
    magRange,
  }) as const;
