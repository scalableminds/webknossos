import type { LandmarkPairInfo } from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import type { LayerRegistrationViewState } from "viewer/view/layer_registration/layer_registration_protocol";

type SetLayerRegistrationViewStateAction = ReturnType<typeof setLayerRegistrationViewStateAction>;
type SetLandmarkPairInfoAction = ReturnType<typeof setLandmarkPairInfoAction>;

export type LayerRegistrationWorkerAction =
  | SetLayerRegistrationViewStateAction
  | SetLandmarkPairInfoAction;

export const setLayerRegistrationViewStateAction = (viewState: LayerRegistrationViewState) =>
  ({
    type: "SET_LAYER_REGISTRATION_VIEW_STATE",
    viewState,
  }) as const;

export const setLandmarkPairInfoAction = (pairInfo: LandmarkPairInfo) =>
  ({
    type: "SET_LANDMARK_PAIR_INFO",
    pairInfo,
  }) as const;
