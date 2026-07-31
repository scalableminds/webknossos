type SetMaximumZoomForAllMagsForLayerAction = ReturnType<
  typeof setMaximumZoomForAllMagsForLayerAction
>;
type AdjustZoomToFinestSharedMagAction = ReturnType<typeof adjustZoomToFinestSharedMagAction>;

export type FlycamInfoCacheAction =
  | SetMaximumZoomForAllMagsForLayerAction
  | AdjustZoomToFinestSharedMagAction;

export const setMaximumZoomForAllMagsForLayerAction = (layerName: string, magRange: number[]) =>
  ({
    type: "SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER",
    layerName,
    magRange,
  }) as const;

// Requests that the zoom is adjusted to the finest mag that all layers share, as soon as the
// (viewport-aware) zoom ranges are known. This is only dispatched during initialization if no
// zoom was configured via URL, user state, tracing or view configuration.
// See adjustZoomToFinestSharedMagSaga.
export const adjustZoomToFinestSharedMagAction = () =>
  ({
    type: "ADJUST_ZOOM_TO_FINEST_SHARED_MAG",
  }) as const;
