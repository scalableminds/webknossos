import { addToNestedMap, addToSetMap } from "libs/utils";
import type { LayerNameAsKey } from "types/type_utils";
import type { PreservedMeshDisplayProps } from "../../volume/proofreading/proofreading_types";

export type SplitInfo = {
  oldAgglomerateIds: ReadonlySet<bigint>;
  newAgglomerateIds: ReadonlySet<bigint>;
  newToOldAgglomerateIds: ReadonlyMap<bigint, bigint>;
};

/*
 * Collects which proofreading meshes are outdated by merges and splits of other users. The
 * collector is filled while the update actions of other users are applied (see
 * tryToIncorporateActions). The meshes are removed and reloaded afterwards (see
 * applyMeshRefreshes in mesh_refresh_sagas.ts).
 * The display properties (opacity and visibility) of the reloaded meshes must be recorded while
 * the original meshes still exist, so that the reloaded meshes look the same as before.
 */
export class MeshRefreshCollector {
  private readonly meshIdsToRemove: Map<LayerNameAsKey, Set<bigint>> = new Map();
  private readonly displayPropsOfMeshesToLoad: Map<
    LayerNameAsKey,
    Map<bigint, PreservedMeshDisplayProps>
  > = new Map();

  get meshIdsToRemovePerLayer(): ReadonlyMap<LayerNameAsKey, ReadonlySet<bigint>> {
    return this.meshIdsToRemove;
  }

  // Maps each agglomerate id whose mesh should be (re)loaded to the display properties the
  // reloaded mesh should get.
  get displayPropsOfMeshesToLoadPerLayer(): ReadonlyMap<
    LayerNameAsKey,
    ReadonlyMap<bigint, PreservedMeshDisplayProps>
  > {
    return this.displayPropsOfMeshesToLoad;
  }

  // Returns the display properties of the meshes that will be shown once the recorded refreshes
  // are applied, by agglomerate id. displayPropsOfMeshesInScene are those of the meshes shown now.
  // The scene is only updated after all actions of a rebase were applied, so a merge or split must
  // use this instead of the scene to see the effect of earlier merges and splits of the same
  // rebase.
  getDisplayPropsOfShownMeshesAfterRefresh(
    layerName: LayerNameAsKey,
    displayPropsOfMeshesInScene: ReadonlyMap<bigint, PreservedMeshDisplayProps>,
  ): Map<bigint, PreservedMeshDisplayProps> {
    const displayPropsAfterRefresh = new Map(displayPropsOfMeshesInScene);
    for (const agglomerateId of this.meshIdsToRemove.get(layerName) ?? []) {
      displayPropsAfterRefresh.delete(agglomerateId);
    }
    const displayPropsOfMeshesToLoad = this.displayPropsOfMeshesToLoad.get(layerName) ?? [];
    for (const [agglomerateId, displayProps] of displayPropsOfMeshesToLoad) {
      displayPropsAfterRefresh.set(agglomerateId, displayProps);
    }
    return displayPropsAfterRefresh;
  }

  // targetId was merged into sourceId. Both meshes are outdated, but only the merged mesh, which
  // keeps sourceId, needs to be loaded.
  recordMerge(
    layerName: LayerNameAsKey,
    sourceId: bigint,
    targetId: bigint,
    mergedMeshDisplayProps: PreservedMeshDisplayProps,
  ) {
    addToSetMap(this.meshIdsToRemove, layerName, sourceId);
    addToSetMap(this.meshIdsToRemove, layerName, targetId);
    addToNestedMap(this.displayPropsOfMeshesToLoad, layerName, sourceId, mergedMeshDisplayProps);
    // A reload of targetId recorded by an earlier action is not needed anymore, because
    // targetId does not exist after the merge.
    this.displayPropsOfMeshesToLoad.get(layerName)?.delete(targetId);
  }

  // The meshes of all old agglomerates are outdated. Each new agglomerate gets the display
  // properties of the old agglomerate it was split off from.
  recordSplit(
    layerName: LayerNameAsKey,
    { oldAgglomerateIds, newAgglomerateIds, newToOldAgglomerateIds }: SplitInfo,
    displayPropsByOldAgglomerateId: ReadonlyMap<bigint, PreservedMeshDisplayProps>,
  ) {
    for (const oldAgglomerateId of oldAgglomerateIds) {
      addToSetMap(this.meshIdsToRemove, layerName, oldAgglomerateId);
    }
    for (const newAgglomerateId of newAgglomerateIds) {
      const oldAgglomerateId = newToOldAgglomerateIds.get(newAgglomerateId);
      const displayProps =
        (oldAgglomerateId != null
          ? displayPropsByOldAgglomerateId.get(oldAgglomerateId)
          : undefined) ?? {};
      addToNestedMap(this.displayPropsOfMeshesToLoad, layerName, newAgglomerateId, displayProps);
    }
  }
}
