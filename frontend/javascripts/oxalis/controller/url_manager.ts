import ErrorHandling from "libs/error_handling";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { coalesce } from "libs/utils";
import window, { location } from "libs/window";
import _ from "lodash";
import messages from "messages";
import type { Vector3, ViewMode } from "oxalis/constants";
import constants, { ViewModeValues, MappingStatusEnum } from "oxalis/constants";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getMeshesForCurrentAdditionalCoordinates } from "oxalis/model/accessors/volumetracing_accessor";
import {
  additionalCoordinateToKeyValue,
  parseAdditionalCoordinateKey,
} from "oxalis/model/helpers/nml_helpers";
import { applyState } from "oxalis/model_initialization";
import type { MappingType, MeshInformation, OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import { type APIAnnotationType, APICompoundTypeEnum } from "types/api_flow_types";
import type { APIDataset, AdditionalCoordinate } from "types/api_flow_types";
import { validateUrlStateJSON } from "types/validation";

const MAX_UPDATE_INTERVAL = 1000;
const MINIMUM_VALID_CSV_LENGTH = 5;

type BaseMeshUrlDescriptor = {
  readonly segmentId: number;
  readonly seedPosition: Vector3;
  readonly seedAdditionalCoordinates?: AdditionalCoordinate[];
};
type AdHocMeshUrlDescriptor = BaseMeshUrlDescriptor & {
  readonly isPrecomputed: false;
  mappingName: string | null | undefined;
  mappingType: MappingType | null | undefined;
};
type PrecomputedMeshUrlDescriptor = BaseMeshUrlDescriptor & {
  readonly isPrecomputed: true;
  meshFileName: string;
};
type MeshUrlDescriptor = AdHocMeshUrlDescriptor | PrecomputedMeshUrlDescriptor;
export type UrlStateByLayer = Record<
  string,
  {
    meshInfo?: {
      meshFileName: string | null | undefined;
      meshes: Array<MeshUrlDescriptor>;
    };
    mappingInfo?: {
      mappingName: string;
      mappingType: MappingType;
      agglomerateIdsToImport?: Array<number>;
    };
    connectomeInfo?: {
      connectomeName: string;
      agglomerateIdsToImport?: Array<number>;
    };
    isDisabled?: boolean;
  }
>;

function mapMeshInfoToUrlMeshDescriptor(meshInfo: MeshInformation): MeshUrlDescriptor {
  const { segmentId, seedPosition } = meshInfo;
  const baseUrlDescriptor: BaseMeshUrlDescriptor = {
    segmentId,
    seedPosition: V3.floor(seedPosition),
  };

  if (meshInfo.isPrecomputed) {
    const { meshFileName } = meshInfo;
    return { ...baseUrlDescriptor, isPrecomputed: true, meshFileName };
  } else {
    const { mappingName, mappingType } = meshInfo;
    return { ...baseUrlDescriptor, isPrecomputed: false, mappingName, mappingType };
  }
}

// extracts the dataset name from view or sandbox the URLs.
export function getDatasetNameFromLocation(
  location: (typeof window)["location"],
): string | undefined {
  // URL format: /datasets/<dataset-name>-<dataset-id>/<view|sandbox/type>...
  const pathnameParts = location.pathname.split("/").slice(1); // First string is empty as pathname start with a /.
  const endOfDatasetName = pathnameParts[1].lastIndexOf("-");
  if (endOfDatasetName <= 0) {
    return undefined;
  }
  const datasetNameInURL = pathnameParts[1].substring(0, endOfDatasetName);
  return datasetNameInURL;
}

export function getUpdatedPathnameWithNewDatasetName(
  location: (typeof window)["location"],
  dataset: APIDataset,
): string {
  const pathnameParts = location.pathname.split("/").slice(1); // First string is empty as pathname start with a /.
  const newNameAndIdPart = `${dataset.name}-${dataset.id}`;
  const newPathname = `/${pathnameParts[0]}/${newNameAndIdPart}/${pathnameParts.slice(2).join("/")}`;
  return newPathname;
}

// If the type of UrlManagerState changes, the following files need to be updated:
// docs/sharing.md#sharing-link-format
// frontend/javascripts/types/schemas/url_state.schema.ts
export type UrlManagerState = {
  position?: Vector3;
  mode?: ViewMode;
  zoomStep?: number;
  activeNode?: number;
  rotation?: Vector3;
  stateByLayer?: UrlStateByLayer;
  additionalCoordinates?: AdditionalCoordinate[] | null;
};
export type PartialUrlManagerState = Partial<UrlManagerState>;

class UrlManager {
  baseUrl: string = "";
  initialState: PartialUrlManagerState = {};
  stopStoreListening?: () => void;

  initialize() {
    this.baseUrl = location.pathname + location.search;
    this.initialState = this.parseUrlHash();
  }

  reset(keepUrlState: boolean = false, keepUrlSearch: boolean = false): void {
    // don't use location.hash = ""; since it refreshes the page
    if (!keepUrlState) {
      window.history.replaceState(
        {},
        "",
        location.pathname + (keepUrlSearch ? location.search : ""),
      );
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
    window.history.replaceState({}, "", url);
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
    } else if (urlHash.split(",")[0].includes("=")) {
      // The hash was changed by a comment link
      return this.parseUrlHashCommentLink(urlHash);
    } else {
      // The hash is in csv format (it can also contain
      // key=value pairs, but only after the first mandatory
      // CSV values).
      return this.parseUrlHashCsv(urlHash);
    }
  }

  parseUrlHashCommentLink(urlHash: string): PartialUrlManagerState {
    // Comment link format:
    // activeNode=12 or position=1,2,3
    const [key, value] = urlHash.split("=");
    // The value can either be a single number or multiple numbers delimited by a ,
    return {
      [key]: value.includes(",") ? value.split(",").map(Number) : Number(value),
    };
  }

  parseUrlHashJson(urlHash: string): PartialUrlManagerState {
    // State json format:
    // { "position": Vector3, "mode": number, "zoomStep": number, ...}
    try {
      return validateUrlStateJSON(urlHash);
    } catch (e) {
      Toast.error(messages["tracing.invalid_json_url_hash"]);
      console.error(e);
      ErrorHandling.notify(e as Error);
      return {};
    }
  }

  parseUrlHashCsv(urlHash: string): PartialUrlManagerState {
    // State string format:
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode][,key=value]*
    const state: PartialUrlManagerState = {};

    if (!urlHash) {
      return state;
    }

    const commaSeparatedValues = urlHash.split(",");
    const [baseValues, keyValuePairStrings] = _.partition(
      commaSeparatedValues,
      (value) => !value.includes("="),
    );
    const stateArray = baseValues.map(Number);
    const validStateArray = stateArray.map((value) => (!isNaN(value) ? value : 0));

    if (validStateArray.length >= MINIMUM_VALID_CSV_LENGTH) {
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

    const additionalCoordinates = [];
    const keyValuePairs = keyValuePairStrings.map((keyValueStr) => keyValueStr.split("=", 2));
    for (const [key, value] of keyValuePairs) {
      const coordinateName = parseAdditionalCoordinateKey(key, true);
      if (coordinateName != null) {
        additionalCoordinates.push({
          name: coordinateName,
          value: Number.parseFloat(value),
        });
      }
    }

    if (additionalCoordinates.length > 0) {
      state.additionalCoordinates = additionalCoordinates;
    }

    return state;
  }

  startUrlUpdater(): void {
    this.stopStoreListening = Store.subscribe(() => this.update());

    window.onhashchange = () => this.onHashChange();
  }

  stopUrlUpdater(): void {
    if (this.stopStoreListening != null) {
      this.stopStoreListening();
    }
    window.onhashchange = null;
  }

  getUrlState(state: OxalisState): UrlManagerState & { mode: ViewMode } {
    const position: Vector3 = V3.floor(getPosition(state.flycam));
    const { viewMode: mode } = state.temporaryConfiguration;
    const zoomStep = Utils.roundTo(state.flycam.zoomStep, 3);
    const rotationOptional = constants.MODES_ARBITRARY.includes(mode)
      ? {
          rotation: Utils.map3((e) => Utils.roundTo(e, 2), getRotation(state.flycam)),
        }
      : {};
    const activeNode = state.annotation.skeleton?.activeNodeId;
    const activeNodeOptional = activeNode != null ? { activeNode } : {};
    const stateByLayer: UrlStateByLayer = {};

    for (const layerName of Object.keys(state.temporaryConfiguration.activeMappingByLayer)) {
      const mappingInfo = state.temporaryConfiguration.activeMappingByLayer[layerName];

      if (
        mappingInfo.mappingStatus === MappingStatusEnum.ENABLED &&
        mappingInfo.mappingName != null
      ) {
        const { mappingName, mappingType } = mappingInfo;
        stateByLayer[layerName] = {
          ...stateByLayer[layerName],
          mappingInfo: {
            mappingName,
            mappingType,
          },
        };
      }
    }

    for (const layerName of Object.keys(state.localSegmentationData)) {
      const { currentMeshFile } = state.localSegmentationData[layerName];
      const currentMeshFileName = currentMeshFile?.meshFileName;
      const localMeshes = getMeshesForCurrentAdditionalCoordinates(state, layerName);
      const meshes =
        localMeshes != null
          ? Utils.values(localMeshes)
              .filter(({ isVisible }) => isVisible)
              .map(mapMeshInfoToUrlMeshDescriptor)
          : [];

      if (currentMeshFileName != null || meshes.length > 0) {
        stateByLayer[layerName] = {
          ...stateByLayer[layerName],
          meshInfo: {
            meshFileName: currentMeshFileName,
            meshes,
          },
        };
      }
    }

    for (const layerName of Object.keys(state.datasetConfiguration.layers)) {
      const layerConfiguration = state.datasetConfiguration.layers[layerName];

      if (layerConfiguration != null) {
        stateByLayer[layerName] = {
          ...stateByLayer[layerName],
          isDisabled: layerConfiguration.isDisabled,
        };
      }
    }

    const annotation = state.annotation;
    if (annotation.skeleton != null) {
      const skeletonTracing = enforceSkeletonTracing(annotation);
      const { showSkeletons } = skeletonTracing;
      const layerName = "Skeleton";

      stateByLayer[layerName] = {
        ...stateByLayer[layerName],
        isDisabled: !showSkeletons,
      };
    }

    const stateByLayerOptional =
      _.size(stateByLayer) > 0
        ? {
            stateByLayer,
          }
        : {};
    return {
      position,
      mode,
      zoomStep,
      additionalCoordinates: state.flycam.additionalCoordinates,
      ...rotationOptional,
      ...activeNodeOptional,
      ...stateByLayerOptional,
    };
  }

  buildUrlHashCsv(state: OxalisState): string {
    const { position = [], mode, zoomStep, rotation = [], activeNode } = this.getUrlState(state);
    const viewModeIndex = ViewModeValues.indexOf(mode);
    const activeNodeArray = activeNode != null ? [activeNode] : [];
    const keyValuePairs = (state.flycam.additionalCoordinates || []).map((coord) =>
      additionalCoordinateToKeyValue(coord, true),
    );

    return [
      ...position,
      viewModeIndex,
      zoomStep,
      ...rotation,
      ...activeNodeArray,
      ...keyValuePairs.map(([key, value]) => `${key}=${value}`),
    ].join(",");
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
      state.annotation.annotationType,
      state.annotation.annotationId,
    );
    return `${newBaseUrl}#${hash}`;
  }
}

export function updateTypeAndId(
  baseUrl: string,
  annotationType: APIAnnotationType,
  annotationId: string,
): string {
  // Update the baseUrl with a potentially new annotation id and or tracing type.
  // There are two possible routes (/annotations or /datasets), but the annotation id
  // will only ever be updated for the annotations route as the other route is for
  // dataset viewing only.
  // Note that for non-compounds (i.e., Explorationals and Tasks), these types won't
  // appear in the URL. For backwards compatibility old URLs containing Explorational/Task
  // still work, but they are immediately redirected to the URL version without that part.

  const maybeCompoundType = coalesce(
    APICompoundTypeEnum,
    annotationType as unknown as APICompoundTypeEnum,
  );
  if (maybeCompoundType == null) {
    return baseUrl.replace(
      /^(.*\/annotations)\/([^/?]*)(\/?.*)$/,
      (_all, base, _id, rest) => `${base}/${annotationId}${rest}`,
    );
  } else {
    return baseUrl.replace(
      /^(.*\/annotations)\/(.*?)\/([^/?]*)(\/?.*)$/,
      (_all, base, _type, _id, rest) => `${base}/${maybeCompoundType}/${annotationId}${rest}`,
    );
  }
}
// encodeURIComponent encodes all characters except [A-Za-z0-9] - _ . ! ~ * ' ( )
// see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
// The url hash can contain ! $ & ' ( ) * + , ; =  - . _ ~ : @ / ? or [a-zA-Z0-9] or %[0-9a-fA-F]{2}
// see https://stackoverflow.com/a/2849800
// Whitelist the characters that are part of the second list, but not of the first as they don't need to be encoded
// for better url readability
const urlHashCharacterWhiteList = ["$", "&", "+", ",", ";", "=", ":", "@", "/", "?"];
// Build lookup table from encoded to decoded value
const encodedCharacterToDecodedCharacter = urlHashCharacterWhiteList.reduce(
  (obj, decodedValue) => {
    obj[encodeURIComponent(decodedValue)] = decodedValue;
    return obj;
  },
  {} as Record<string, string>,
);
// Build RegExp that matches each of the encoded characters (%xy) and a function to decode it
const re = new RegExp(Object.keys(encodedCharacterToDecodedCharacter).join("|"), "gi");

const decodeWhitelistedCharacters = (matched: string) =>
  encodedCharacterToDecodedCharacter[matched];

export function encodeUrlHash(unencodedHash: string): string {
  const urlEncodedHash = encodeURIComponent(unencodedHash);
  return urlEncodedHash.replace(re, decodeWhitelistedCharacters);
}
export default new UrlManager();
