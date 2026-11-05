import { V3 } from "libs/mjs";
import memoizeOne from "memoize-one";
import type { MetadataEntryProto } from "types/api_types";
import Constants, { MappingStatusEnum, type Vector3 } from "viewer/constants";
import { getLayerByName, getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { type Tree, TreeMap } from "viewer/model/types/tree_types";
import type {
  AgglomerateDiff,
  AgglomerateDiffDescriptor,
  AgglomerateDiffOverlay,
  SkeletonTracing,
  WebknossosState,
} from "viewer/store";

export function getAgglomerateDiffKey(descriptor: AgglomerateDiffDescriptor): string {
  return JSON.stringify([
    descriptor.layerName,
    descriptor.mappingName,
    descriptor.agglomerateId.toString(),
    descriptor.referenceMappingName,
  ]);
}

/*
 * Agglomerate skeletons store the following information as tree metadata, so that their diffs are
 * the same after reloading the annotation:
 * - The layer they were loaded for. Otherwise, agglomerate skeletons of layers whose agglomerate
 *   files have the same names couldn't be told apart.
 * - The clicked position (in the coordinate system of the layer), if they were loaded by clicking on
 *   a segment. The diff compares the reference agglomerate of the clicked segment.
 */
const LAYER_NAME_METADATA_KEY = "layerName";
const CLICKED_POSITION_METADATA_KEY = "clickedPosition";

export function createAgglomerateSkeletonMetadata(
  layerName: string,
  clickedPositionInLayer: Vector3 | null,
): MetadataEntryProto[] {
  const metadata: MetadataEntryProto[] = [{ key: LAYER_NAME_METADATA_KEY, stringValue: layerName }];
  if (clickedPositionInLayer != null) {
    metadata.push({
      key: CLICKED_POSITION_METADATA_KEY,
      stringListValue: clickedPositionInLayer.map((coordinate) =>
        Math.floor(coordinate).toString(),
      ),
    });
  }
  return metadata;
}

// Returns null for agglomerate skeletons that were loaded before the layer was stored
export function getLayerNameOfAgglomerateSkeleton(tree: Tree): string | null {
  return tree.metadata.find(({ key }) => key === LAYER_NAME_METADATA_KEY)?.stringValue ?? null;
}

// Returns null if the position is missing or was edited to something invalid
export function getClickedPositionInLayer(tree: Tree): Vector3 | null {
  const entries = tree.metadata.find(
    ({ key }) => key === CLICKED_POSITION_METADATA_KEY,
  )?.stringListValue;
  // Number("") would be 0
  if (entries?.length !== 3 || entries.some((entry) => entry.trim() === "")) return null;
  const position = entries.map(Number);
  if (!position.every(Number.isFinite)) return null;
  return position.map(Math.floor) as Vector3;
}

// Whether the diff compares the reference agglomerate at the given position (see AgglomerateDiff)
export function isDiffOfPosition(diff: AgglomerateDiff, positionInLayer: Vector3): boolean {
  return V3.isEqual(diff.positionInLayer, positionInLayer.map(Math.floor) as Vector3);
}

// Agglomerate skeletons can only be loaded while an agglomerate mapping is active, so their diffs
// are only shown in that case, too.
export function isAgglomerateMappingEnabled(state: WebknossosState, layerName: string): boolean {
  const { mappingStatus, mappingType } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  return mappingStatus === MappingStatusEnum.ENABLED && mappingType === "AGGLOMERATE";
}

// The agglomerate view that agglomerate skeletons of the layer are compared against, if any
export function getAgglomerateDiffReferenceMappingName(
  state: WebknossosState,
  layerName: string,
): string | null {
  return state.datasetConfiguration.layers[layerName]?.agglomerateDiffReference ?? null;
}

// Whether the agglomerate files of the layer need to be loaded to know which agglomerate skeletons
// are compared to the reference view (see getAgglomerateDiffReferenceForSkeleton)
export function needsAgglomerateFilesForDiffs(state: WebknossosState, layerName: string): boolean {
  const layer = getLayerByName(state.dataset, layerName);
  return (
    layer.category === "segmentation" &&
    layer.agglomerates == null &&
    getAgglomerateDiffReferenceMappingName(state, layerName) != null &&
    isAgglomerateMappingEnabled(state, layerName)
  );
}

/*
 * Returns the reference view that agglomerate skeletons of the layer are compared to, or null if
 * they are not compared. That is the case if
 * - no reference view is selected or no agglomerate mapping is active,
 * - the agglomerate files of the layer are not known, yet (see needsAgglomerateFilesForDiffs), or
 * - the reference view is not an agglomerate file of the layer (e.g., if it was removed from the
 *   dataset since it was selected).
 * Whether a single agglomerate skeleton is compared is decided by isComparedToAgglomerateDiffReference.
 */
export function getUsableAgglomerateDiffReference(
  state: WebknossosState,
  layerName: string,
): string | null {
  const referenceMappingName = getAgglomerateDiffReferenceMappingName(state, layerName);
  if (referenceMappingName == null || !isAgglomerateMappingEnabled(state, layerName)) return null;
  const layer = getLayerByName(state.dataset, layerName);
  if (layer.category !== "segmentation" || !layer.agglomerates?.includes(referenceMappingName)) {
    return null;
  }
  return referenceMappingName;
}

// Whether agglomerate skeletons of the given agglomerate view are compared to the usable reference
// view of their layer (see getUsableAgglomerateDiffReference). This is not the case for the reference
// view itself and for views that are no agglomerate files (i.e., editable mappings).
export function isComparedToAgglomerateDiffReference(
  agglomerateFiles: ReadonlyArray<string>,
  mappingName: string,
  referenceMappingName: string,
): boolean {
  return mappingName !== referenceMappingName && agglomerateFiles.includes(mappingName);
}

// Combines getUsableAgglomerateDiffReference and isComparedToAgglomerateDiffReference
export function getAgglomerateDiffReferenceForSkeleton(
  state: WebknossosState,
  layerName: string,
  mappingName: string,
): string | null {
  const referenceMappingName = getUsableAgglomerateDiffReference(state, layerName);
  const layer = getLayerByName(state.dataset, layerName);
  if (
    referenceMappingName == null ||
    layer.category !== "segmentation" ||
    !isComparedToAgglomerateDiffReference(
      layer.agglomerates ?? [],
      mappingName,
      referenceMappingName,
    )
  ) {
    return null;
  }
  return referenceMappingName;
}

export function getAgglomerateDiffOverlay(state: WebknossosState): AgglomerateDiffOverlay {
  return state.localSkeletonState.agglomerateDiffOverlay;
}

export function getAgglomerateDiffSkeleton(state: WebknossosState): SkeletonTracing {
  return getAgglomerateDiffOverlay(state).skeleton;
}

const NO_TREE_IDS: ReadonlySet<number> = new Set();

const getAgglomerateTreeIdsWithVisibleDiffsMemoized = memoizeOne(
  (diffs: AgglomerateDiffOverlay["diffs"], areDiffsVisible: boolean): ReadonlySet<number> => {
    if (!areDiffsVisible) return NO_TREE_IDS;
    const treeIds = new Set<number>();
    for (const diff of Object.values(diffs)) {
      if (diff.sourceTreeId != null && diff.isSourceTreeVisible && diff.treeIds.length > 0) {
        treeIds.add(diff.sourceTreeId);
      }
    }
    return treeIds.size > 0 ? treeIds : NO_TREE_IDS;
  },
);

// The agglomerate skeletons whose diffs are shown. They are dimmed, so that the diffs stand out.
export function getAgglomerateTreeIdsWithVisibleDiffs(state: WebknossosState): ReadonlySet<number> {
  const overlay = getAgglomerateDiffOverlay(state);
  return getAgglomerateTreeIdsWithVisibleDiffsMemoized(overlay.diffs, overlay.isVisible);
}

export function createEmptyAgglomerateDiffOverlay(): AgglomerateDiffOverlay {
  return {
    diffs: {},
    isVisible: true,
    skeleton: {
      createdTimestamp: Date.now(),
      type: "skeleton",
      activeNodeId: null,
      cachedMaxNodeId: Constants.MIN_NODE_ID - 1,
      trees: new TreeMap(),
      treeGroups: [],
      tracingId: "agglomerate-diff-overlay",
      boundingBox: null,
      userBoundingBoxes: [],
      additionalAxes: [],
    },
  };
}
