import { getBuildInfo } from "admin/rest_api";
import type { APIBuildInfoWk } from "types/api_types";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { serializeToNml } from "viewer/model/helpers/nml_helpers";
import { type Tree, TreeMap } from "viewer/model/types/tree_types";
import type { WebknossosState } from "viewer/store";

// The build info is only needed for the NML header. The layer registration view exports trees
// several times per second, so it is fetched only once.
let buildInfoPromise: Promise<APIBuildInfoWk> | null = null;
function getBuildInfoForNmlExport(): Promise<APIBuildInfoWk> {
  if (buildInfoPromise == null) {
    buildInfoPromise = getBuildInfo().catch((error) => {
      buildInfoPromise = null;
      throw error;
    });
  }
  return buildInfoPromise;
}

// Serializes the given trees of the skeleton annotation to an NML string. Unlike the NML
// download, hidden trees are included and tree groups are left out, so importing the result puts
// all trees at the root level. The trees keep their tree ids.
export async function serializeTreesToFlatNml(
  state: WebknossosState,
  trees: Tree[],
): Promise<string> {
  const exportedTrees = trees.map((tree): [number, Tree] => [
    tree.treeId,
    { ...tree, isVisible: true, groupId: null },
  ]);
  const exportedTracing = {
    ...enforceSkeletonTracing(state.annotation),
    trees: new TreeMap(exportedTrees),
    treeGroups: [],
  };
  const buildInfo = await getBuildInfoForNmlExport();
  return serializeToNml(state, state.annotation, exportedTracing, buildInfo, false);
}
