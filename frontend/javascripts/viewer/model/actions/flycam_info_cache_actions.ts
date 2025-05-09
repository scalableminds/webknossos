type SetMaximumZoomForAllMagsForLayerAction = ReturnType<
  typeof setMaximumZoomForAllMagsForLayerAction
>;

export type FlycamInfoCacheAction = SetMaximumZoomForAllMagsForLayerAction;

export const setMaximumZoomForAllMagsForLayerAction = (layerName: string, magRange: number[]) =>
  ({
    type: "SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER",
    layerName,
    magRange,
  }) as const;
