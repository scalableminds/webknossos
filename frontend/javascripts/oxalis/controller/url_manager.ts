import _ from "lodash";
import { V3 } from "libs/mjs";
import { applyState } from "oxalis/model_initialization";
import { getRotation, getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getSkeletonTracing,
  getActiveNode,
  enforceSkeletonTracing,
} from "oxalis/model/accessors/skeletontracing_accessor";
import type { OxalisState, MappingType, IsosurfaceInformation } from "oxalis/store";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import type { ViewMode, Vector3 } from "oxalis/constants";
import constants, { ViewModeValues, MappingStatusEnum } from "oxalis/constants";
import window, { location } from "libs/window";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import messages from "messages";
import { validateUrlStateJSON } from "types/validation";
import { APIAnnotationType, APICompoundTypeEnum } from "types/api_flow_types";
import { coalesce } from "libs/utils";
import { type AdditionalCoordinate } from "types/api_flow_types";

const MAX_UPDATE_INTERVAL = 1000;

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

function mapIsosurfaceInfoToUrlMeshDescriptor(
  isosurfaceInfo: IsosurfaceInformation,
): MeshUrlDescriptor {
  const { segmentId, seedPosition } = isosurfaceInfo;
  const baseUrlDescriptor: BaseMeshUrlDescriptor = {
    segmentId,
    seedPosition: V3.floor(seedPosition),
  };

  if (isosurfaceInfo.isPrecomputed) {
    const { meshFileName } = isosurfaceInfo;
    return { ...baseUrlDescriptor, isPrecomputed: true, meshFileName };
  } else {
    const { mappingName, mappingType } = isosurfaceInfo;
    return { ...baseUrlDescriptor, isPrecomputed: false, mappingName, mappingType };
  }
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
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'baseUrl' has no initializer and is not d... Remove this comment to see the full error message
  baseUrl: string;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'initialState' has no initializer and is ... Remove this comment to see the full error message
  initialState: PartialUrlManagerState;

  initialize() {
    this.baseUrl = location.pathname + location.search;
    this.initialState = this.parseUrlHash();
  }

  reset(keepUrlState: boolean = false): void {
    // don't use location.hash = ""; since it refreshes the page
    if (!keepUrlState) {
      window.history.replaceState({}, "", location.pathname + location.search);
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
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]
    const state: PartialUrlManagerState = {};

    if (urlHash) {
      const stateArray = urlHash.split(",").map(Number);
      const validStateArray = stateArray.map((value) => (!isNaN(value) ? value : 0));

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
      ? {
          rotation: Utils.map3((e) => Utils.roundTo(e, 2), getRotation(state.flycam)),
        }
      : {};
    const activeNodeOptional = getSkeletonTracing(state.tracing)
      .chain((skeletonTracing) => getActiveNode(skeletonTracing))
      .map((node) => ({
        activeNode: node.id,
      }))
      .getOrElse({});
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
      const { isosurfaces, currentMeshFile } = state.localSegmentationData[layerName];
      const currentMeshFileName = currentMeshFile?.meshFileName;
      const meshes = Utils.values(isosurfaces)
        .filter(({ isVisible }) => isVisible)
        .map(mapIsosurfaceInfoToUrlMeshDescriptor);

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

    const tracing = state.tracing;
    if (tracing.skeleton != null) {
      const skeletonTracing = enforceSkeletonTracing(tracing);
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
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
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
const encodedCharacterToDecodedCharacter = urlHashCharacterWhiteList.reduce((obj, decodedValue) => {
  obj[encodeURIComponent(decodedValue)] = decodedValue;
  return obj;
}, {} as Record<string, string>);
// Build RegExp that matches each of the encoded characters (%xy) and a function to decode it
const re = new RegExp(Object.keys(encodedCharacterToDecodedCharacter).join("|"), "gi");

const decodeWhitelistedCharacters = (matched: string) =>
  encodedCharacterToDecodedCharacter[matched];

export function encodeUrlHash(unencodedHash: string): string {
  const urlEncodedHash = encodeURIComponent(unencodedHash);
  return urlEncodedHash.replace(re, decodeWhitelistedCharacters);
}
export default new UrlManager();
