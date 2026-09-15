import { getDataLayers } from "viewer/model/accessors/dataset_accessor";
import type { Action } from "viewer/model/actions/actions";
import { changeUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { updateKey2 } from "viewer/model/helpers/deep_update";
import type { MipLayerConfig, WebknossosState } from "viewer/store";
import { updateUserBoundingBox } from "./annotation_reducer";

// Enabling a MIP for a bbox that is currently hidden would otherwise render nothing, since the MIP
// mesh's visibility is tied to the bbox's own visibility
function makeBBoxVisible(state: WebknossosState, bboxId: number): WebknossosState {
  if (bboxId < 0) {
    const layerIndex = -2 - bboxId;
    const layer = getDataLayers(state.dataset)[layerIndex];
    if (layer == null) return state;

    return updateKey2(state, "temporaryConfiguration", "layerBoundingBoxVisibilities", {
      [layer.name]: true,
    });
  }
  return updateUserBoundingBox(state, changeUserBoundingBoxAction(bboxId, { isVisible: true }));
}

function MipBBoxReducer(state: WebknossosState, action: Action): WebknossosState {
  const { mipBBoxSettings } = state.uiInformation;

  switch (action.type) {
    case "SET_MIP_FOR_BBOX": {
      const existing = mipBBoxSettings[action.id] ?? [];
      const updated = existing.some((l) => l.layerName === action.config.layerName)
        ? existing.map((l) => (l.layerName === action.config.layerName ? action.config : l))
        : [...existing, action.config];
      const nextState = {
        ...state,
        uiInformation: {
          ...state.uiInformation,
          mipBBoxSettings: { ...mipBBoxSettings, [action.id]: updated },
        },
      };
      return makeBBoxVisible(nextState, action.id);
    }

    case "REMOVE_MIP_LAYER_FOR_BBOX": {
      const existing = mipBBoxSettings[action.id] ?? [];
      const updated = existing.filter((l) => l.layerName !== action.layerName);
      const next: Record<number, MipLayerConfig[]> = { ...mipBBoxSettings };
      if (updated.length === 0) {
        delete next[action.id];
      } else {
        next[action.id] = updated;
      }
      return { ...state, uiInformation: { ...state.uiInformation, mipBBoxSettings: next } };
    }

    case "REMOVE_MIP_FOR_BBOX": {
      const next: Record<number, MipLayerConfig[]> = { ...mipBBoxSettings };
      delete next[action.id];
      return { ...state, uiInformation: { ...state.uiInformation, mipBBoxSettings: next } };
    }

    case "DELETE_USER_BOUNDING_BOX": {
      if (!(action.id in mipBBoxSettings)) return state;
      const next: Record<number, MipLayerConfig[]> = { ...mipBBoxSettings };
      delete next[action.id];
      return { ...state, uiInformation: { ...state.uiInformation, mipBBoxSettings: next } };
    }

    case "RESET_STORE": {
      return { ...state, uiInformation: { ...state.uiInformation, mipBBoxSettings: {} } };
    }

    default:
      return state;
  }
}

export default MipBBoxReducer;
