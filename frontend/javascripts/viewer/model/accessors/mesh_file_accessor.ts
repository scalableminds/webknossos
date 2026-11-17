import sortBy from "lodash-es/sortBy";
import type { APIMeshFileInfo } from "types/api_types";

// Mesh files with an older format don't store their mapping and are not supported anymore.
const MIN_SUPPORTED_MESH_FILE_VERSION = 3;

export function isMeshFileVersionSupported(meshFile: APIMeshFileInfo) {
  return meshFile.formatVersion >= MIN_SUPPORTED_MESH_FILE_VERSION;
}

export function doesMeshFileMatchMapping(
  meshFile: APIMeshFileInfo,
  activeMappingName: string | null,
) {
  // A mesh file computed without a mapping can be used with every mapping, including an editable one.
  return meshFile.mappingName == null || meshFile.mappingName === activeMappingName;
}

/*
 * Sorts the mesh files so that the most suitable one for the active mapping comes first.
 * During proofreading or without an active mapping, mesh files computed without a mapping are
 * preferred. Otherwise, mesh files computed for the active mapping are preferred, since they load
 * agglomerates faster. They are followed by the ones computed without a mapping.
 */
export function sortMeshFilesByPreference(
  meshFiles: APIMeshFileInfo[],
  activeMappingName: string | null,
  isEditableMappingActive: boolean,
): APIMeshFileInfo[] {
  const getRank = (meshFile: APIMeshFileInfo) => {
    if (!isMeshFileVersionSupported(meshFile)) {
      return 3;
    }
    if (
      !isEditableMappingActive &&
      activeMappingName != null &&
      meshFile.mappingName === activeMappingName
    ) {
      return 0;
    }
    return meshFile.mappingName == null ? 1 : 2;
  };
  return sortBy(meshFiles, getRank);
}
