import type { MetadataEntryProto } from "types/api_types";
import type { Tree } from "viewer/model/types/tree_types";

// Trees that visualize the differences of an agglomerate skeleton to a reference agglomerate view
// are identified via these metadata entries.
const DIFF_METADATA_KEYS = {
  layerName: "agglomerateDiff.layerName",
  agglomerateId: "agglomerateDiff.agglomerateId",
  mappingName: "agglomerateDiff.agglomerateView",
  referenceMappingName: "agglomerateDiff.referenceAgglomerateView",
  segmentId: "agglomerateDiff.segmentId",
  referenceAgglomerateId: "agglomerateDiff.referenceAgglomerateId",
} as const;

// Set by the server on the trees it returns
const SERVER_REFERENCE_AGGLOMERATE_ID_METADATA_KEY = "referenceAgglomerateId";

export type AgglomerateDiffInfo = {
  layerName: string;
  agglomerateId: bigint;
  mappingName: string;
  referenceMappingName: string;
  // The segment whose reference agglomerate was used for the comparison
  segmentId: bigint;
  referenceAgglomerateId: bigint | null;
};

function parseBigInt(value: string | null | undefined): bigint | null {
  if (value == null) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function getReferenceAgglomerateIdOfServerTree(tree: {
  metadata: MetadataEntryProto[];
}): bigint | null {
  return parseBigInt(
    tree.metadata.find((entry) => entry.key === SERVER_REFERENCE_AGGLOMERATE_ID_METADATA_KEY)
      ?.stringValue,
  );
}

export function getAgglomerateDiffInfo(tree: Tree): AgglomerateDiffInfo | null {
  const getValue = (key: string) =>
    tree.metadata.find((entry) => entry.key === key)?.stringValue ?? null;
  const layerName = getValue(DIFF_METADATA_KEYS.layerName);
  const mappingName = getValue(DIFF_METADATA_KEYS.mappingName);
  const referenceMappingName = getValue(DIFF_METADATA_KEYS.referenceMappingName);
  const agglomerateId = parseBigInt(getValue(DIFF_METADATA_KEYS.agglomerateId));
  const segmentId = parseBigInt(getValue(DIFF_METADATA_KEYS.segmentId));
  if (
    layerName == null ||
    agglomerateId == null ||
    segmentId == null ||
    mappingName == null ||
    referenceMappingName == null
  ) {
    return null;
  }
  return {
    layerName,
    agglomerateId,
    mappingName,
    referenceMappingName,
    segmentId,
    referenceAgglomerateId: parseBigInt(getValue(DIFF_METADATA_KEYS.referenceAgglomerateId)),
  };
}

export function getAgglomerateDiffMetadata(info: AgglomerateDiffInfo): MetadataEntryProto[] {
  return [
    { key: DIFF_METADATA_KEYS.layerName, stringValue: info.layerName },
    { key: DIFF_METADATA_KEYS.agglomerateId, stringValue: info.agglomerateId.toString() },
    { key: DIFF_METADATA_KEYS.mappingName, stringValue: info.mappingName },
    { key: DIFF_METADATA_KEYS.referenceMappingName, stringValue: info.referenceMappingName },
    { key: DIFF_METADATA_KEYS.segmentId, stringValue: info.segmentId.toString() },
    ...(info.referenceAgglomerateId != null
      ? [
          {
            key: DIFF_METADATA_KEYS.referenceAgglomerateId,
            stringValue: info.referenceAgglomerateId.toString(),
          },
        ]
      : []),
  ];
}

// Diff trees are rendered on top of other trees, because their edges coincide with the edges of
// the agglomerate skeleton they belong to. This is called by the rendering for many trees, so it
// only checks for a single metadata key instead of parsing all of them like getAgglomerateDiffInfo.
export function isAgglomerateDiffTree(tree: Tree): boolean {
  return tree.metadata.some((entry) => entry.key === DIFF_METADATA_KEYS.agglomerateId);
}
