// @flow

import _ from "lodash";

import { V3 } from "libs/mjs";
import { applyState } from "oxalis/model_initialization";
import { getRotation, getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getSkeletonTracing, getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import Store, { type OxalisState, type MappingType } from "oxalis/store";
import * as Utils from "libs/utils";
import constants, {
  type ViewMode,
  ViewModeValues,
  type Vector3,
  MappingStatusEnum,
} from "oxalis/constants";
import window, { location } from "libs/window";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import messages from "messages";
import { validateUrlStateJSON } from "types/validation";

const MAX_UPDATE_INTERVAL = 1000;

type MeshUrlDescriptor = {|
  +segmentId: number,
  +seedPosition: Vector3,
  +isPrecomputed: boolean,
|};

export type UrlStateByLayer = {
  [layerName: string]: {
    meshInfo?: {
      meshFileName: string,
      meshes?: Array<MeshUrlDescriptor>,
    },
    mappingInfo?: {
      mappingName: string,
      mappingType: MappingType,
      agglomerateIdsToImport?: Array<number>,
    },
  },
};

// If the type of UrlManagerState changes, the following files need to be updated:
// docs/sharing.md#sharing-link-format
// frontend/javascripts/types/schemas/url_state.schema.js
export type UrlManagerState = {|
  position?: Vector3,
  mode?: ViewMode,
  zoomStep?: number,
  activeNode?: number,
  rotation?: Vector3,
  stateByLayer?: UrlStateByLayer,
|};

export type PartialUrlManagerState = $Shape<UrlManagerState>;

class UrlManager {
  baseUrl: string;
  initialState: PartialUrlManagerState;

  initialize() {
    this.baseUrl = location.pathname + location.search;
    this.initialState = this.parseUrlHash();
  }

  reset(keepUrlState?: boolean = false): void {
    // don't use location.hash = ""; since it refreshes the page
    if (!keepUrlState) {
      window.history.replaceState({}, null, location.pathname + location.search);
    }
    this.initialize();
  }

  changeBaseUrl(newBaseUrl: string) {
    this.baseUrl = newBaseUrl;
    this.updateUnthrottled();
  }

  update = _.throttle(() => this.updateUnthrottled(), MAX_UPDATE_INTERVAL);

  updateUnthrottled() {
    const url = this.buildUrl();
    window.history.replaceState({}, null, url);
  }

  onHashChange = () => {
    const urlState = this.parseUrlHash();
    applyState(urlState);
  };

  parseUrlHash(): PartialUrlManagerState {
    const urlHash = decodeURIComponent(location.hash.slice(1));
    if (urlHash.includes("{")) {
      // The hash is in json format
      return this.parseUrlHashJson(urlHash);
    } else if (urlHash.includes("=")) {
      // The hash was changed by a comment link
      return this.parseUrlHashCommentLink(urlHash);
    } else {
      // The hash is in csv format
      return this.parseUrlHashCsv(urlHash);
    }
  }

  parseUrlHashCommentLink(urlHash: string): PartialUrlManagerState {
    // Comment link format:
    // activeNode=12 or position=1,2,3

    const [key, value] = urlHash.split("=");
    // The value can either be a single number or multiple numbers delimited by a ,
    return { [key]: value.includes(",") ? value.split(",").map(Number) : Number(value) };
  }

  parseUrlHashJson(urlHash: string): PartialUrlManagerState {
    // State json format:
    // { "position": Vector3, "mode": number, "zoomStep": number, ...}

    try {
      return validateUrlStateJSON(urlHash);
    } catch (e) {
      Toast.error(messages["tracing.invalid_json_url_hash"]);
      console.error(e);
      ErrorHandling.notify(e);
      return {};
    }
  }

  parseUrlHashCsv(urlHash: string): PartialUrlManagerState {
    // State string format:
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]

    const state: PartialUrlManagerState = {};

    if (urlHash) {
      const stateArray = urlHash.split(",").map(Number);
      const validStateArray = stateArray.map(value => (!isNaN(value) ? value : 0));
      if (validStateArray.length >= 5) {
        const positionValues = validStateArray.slice(0, 3);
        state.position = Utils.numberArrayToVector3(positionValues);

        const modeString = ViewModeValues[validStateArray[3]];
        if (modeString) {
          state.mode = modeString;
        } else {
          // Let's default to MODE_PLANE_TRACING
          state.mode = constants.MODE_PLANE_TRACING;
        }
        // default to zoom step 1
        state.zoomStep = validStateArray[4] !== 0 ? validStateArray[4] : 1;

        if (validStateArray.length >= 8) {
          state.rotation = Utils.numberArrayToVector3(validStateArray.slice(5, 8));

          if (validStateArray[8] != null) {
            state.activeNode = validStateArray[8];
          }
        } else if (validStateArray[5] != null) {
          state.activeNode = validStateArray[5];
        }
      }
    }

    return state;
  }

  startUrlUpdater(): void {
    Store.subscribe(() => this.update());
    window.onhashchange = () => this.onHashChange();
  }

  getUrlState(state: OxalisState): UrlManagerState {
    const position: Vector3 = V3.floor(getPosition(state.flycam));
    const { viewMode: mode } = state.temporaryConfiguration;
    const zoomStep = Utils.roundTo(state.flycam.zoomStep, 3);
    const rotationOptional = constants.MODES_ARBITRARY.includes(mode)
      ? { rotation: Utils.map3(e => Utils.roundTo(e, 2), getRotation(state.flycam)) }
      : {};

    const activeNodeOptional = getSkeletonTracing(state.tracing)
      .chain(skeletonTracing => getActiveNode(skeletonTracing))
      .map(node => ({ activeNode: node.id }))
      .getOrElse({});

    const stateByLayer: UrlStateByLayer = {};
    for (const layerName of Object.keys(state.temporaryConfiguration.activeMappingByLayer)) {
      const mappingInfo = state.temporaryConfiguration.activeMappingByLayer[layerName];
      if (
        mappingInfo.mappingStatus === MappingStatusEnum.ENABLED &&
        mappingInfo.mappingName != null
      ) {
        const { mappingName, mappingType } = mappingInfo;
        stateByLayer[layerName] = { mappingInfo: { mappingName, mappingType } };
      }
    }
    for (const layerName of Object.keys(state.localSegmentationData)) {
      const { isosurfaces, currentMeshFile } = state.localSegmentationData[layerName];
      if (currentMeshFile != null) {
        const { meshFileName } = currentMeshFile;
        const meshes = Utils.values(isosurfaces)
          .filter(({ isVisible }) => isVisible)
          .map(({ segmentId, seedPosition, isPrecomputed }) => ({
            segmentId,
            seedPosition: V3.floor(seedPosition),
            isPrecomputed,
          }));
        stateByLayer[layerName] = { meshInfo: { meshFileName, meshes } };
      }
    }
    const stateByLayerOptional = _.size(stateByLayer) > 0 ? { stateByLayer } : {};

    // $FlowIssue[incompatible-exact] See https://github.com/facebook/flow/issues/2977
    return {
      position,
      mode,
      zoomStep,
      ...rotationOptional,
      ...activeNodeOptional,
      // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
      ...stateByLayerOptional,
    };
  }

  buildUrlHashCsv(state: OxalisState): string {
    const { position = [], mode, zoomStep, rotation = [], activeNode } = this.getUrlState(state);
    const viewModeIndex = ViewModeValues.indexOf(mode);
    const activeNodeArray = activeNode != null ? [activeNode] : [];
    return [...position, viewModeIndex, zoomStep, ...rotation, ...activeNodeArray].join(",");
  }

  buildUrlHashJson(state: OxalisState): string {
    const urlState = this.getUrlState(state);
    return encodeUrlHash(JSON.stringify(urlState));
  }

  buildUrl(): string {
    const state = Store.getState();
    const hash = this.buildUrlHashCsv(state);
    const newBaseUrl = updateTypeAndId(
      this.baseUrl,
      state.tracing.annotationType,
      state.tracing.annotationId,
    );
    return `${newBaseUrl}#${hash}`;
  }
}

export function updateTypeAndId(
  baseUrl: string,
  annotationType: string,
  annotationId: string,
): string {
  // Update the baseUrl with a potentially new annotation id and or tracing type.
  // There are two possible routes (/annotations or /datasets), but the annotation id
  // will only ever be updated for the annotations route as the other route is for
  // dataset viewing only
  return baseUrl.replace(
    /^(.*\/annotations)\/(.*?)\/([^/?]*)(\/?.*)$/,
    (all, base, type, id, rest) => `${base}/${annotationType}/${annotationId}${rest}`,
  );
}

// encodeURIComponent encodes all characters except [A-Za-z0-9] - _ . ! ~ * ' ( )
// see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
// The url hash can contain ! $ & ' ( ) * + , ; =  - . _ ~ : @ / ? or [a-zA-Z0-9] or %[0-9a-fA-F]{2}
// see https://stackoverflow.com/a/2849800
// Whitelist the characters that are part of the second list, but not of the first as they don't need to be encoded
// for better url readability
const urlHashCharacterWhiteList = ["$", "&", "+", ",", ";", "=", ":", "@", "/", "?"];
// Build lookup table from encoded to decoded value
const encodedCharacterToDecodedCharacter = urlHashCharacterWhiteList.reduce((obj, decodedValue) => {
  obj[encodeURIComponent(decodedValue)] = decodedValue;
  return obj;
}, {});
// Build RegExp that matches each of the encoded characters (%xy) and a function to decode it
const re = new RegExp(Object.keys(encodedCharacterToDecodedCharacter).join("|"), "gi");
const decodeWhitelistedCharacters = matched => encodedCharacterToDecodedCharacter[matched];

export function encodeUrlHash(unencodedHash: string): string {
  const urlEncodedHash = encodeURIComponent(unencodedHash);
  return urlEncodedHash.replace(re, decodeWhitelistedCharacters);
}

export default new UrlManager();
