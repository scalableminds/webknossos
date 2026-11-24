import { MeshRefreshCollector } from "viewer/model/sagas/saving/rebasing/mesh_refresh_collector";
import { describe, expect, it } from "vitest";

const layerName = "volumeTracingId";

describe("MeshRefreshCollector", () => {
  it("removes both meshes of a merge and only loads the merged one", () => {
    const meshRefreshes = new MeshRefreshCollector();
    meshRefreshes.recordMerge(layerName, 1n, 2n, { opacity: 0.5, isVisible: true });

    expect(meshRefreshes.meshIdsToRemovePerLayer.get(layerName)).toEqual(new Set([1n, 2n]));
    expect(meshRefreshes.displayPropsOfMeshesToLoadPerLayer.get(layerName)).toEqual(
      new Map([[1n, { opacity: 0.5, isVisible: true }]]),
    );
  });

  it("does not load a mesh that was merged away by a later merge", () => {
    const meshRefreshes = new MeshRefreshCollector();
    meshRefreshes.recordMerge(layerName, 2n, 3n, {});
    meshRefreshes.recordMerge(layerName, 1n, 2n, { opacity: 0.3 });

    expect(meshRefreshes.meshIdsToRemovePerLayer.get(layerName)).toEqual(new Set([1n, 2n, 3n]));
    expect(meshRefreshes.displayPropsOfMeshesToLoadPerLayer.get(layerName)).toEqual(
      new Map([[1n, { opacity: 0.3 }]]),
    );
  });

  it("gives each split-off agglomerate the display props of the agglomerate it came from", () => {
    const meshRefreshes = new MeshRefreshCollector();
    meshRefreshes.recordSplit(
      layerName,
      {
        oldAgglomerateIds: new Set([1n, 5n]),
        newAgglomerateIds: new Set([1n, 7n, 8n]),
        newToOldAgglomerateIds: new Map([
          [1n, 1n],
          [7n, 1n],
          [8n, 5n],
        ]),
      },
      new Map([[1n, { opacity: 0.4, isVisible: false }]]),
    );

    expect(meshRefreshes.meshIdsToRemovePerLayer.get(layerName)).toEqual(new Set([1n, 5n]));
    expect(meshRefreshes.displayPropsOfMeshesToLoadPerLayer.get(layerName)).toEqual(
      new Map([
        [1n, { opacity: 0.4, isVisible: false }],
        [7n, { opacity: 0.4, isVisible: false }],
        // No display props were recorded for agglomerate 5.
        [8n, {}],
      ]),
    );
  });

  it("returns the display props of the meshes shown after the recorded refreshes", () => {
    const meshRefreshes = new MeshRefreshCollector();
    // Mesh 2 was merged into the shown mesh 1, which is reloaded with new props.
    meshRefreshes.recordMerge(layerName, 1n, 2n, { opacity: 0.2 });
    const displayPropsOfMeshesInScene = new Map([
      [1n, { opacity: 0.9 }],
      [2n, { opacity: 0.5 }],
      [3n, { opacity: 0.7 }],
    ]);

    expect(
      meshRefreshes.getDisplayPropsOfShownMeshesAfterRefresh(
        layerName,
        displayPropsOfMeshesInScene,
      ),
    ).toEqual(
      new Map([
        [1n, { opacity: 0.2 }],
        [3n, { opacity: 0.7 }],
      ]),
    );
    // Other layers are not affected.
    expect(
      meshRefreshes.getDisplayPropsOfShownMeshesAfterRefresh(
        "otherLayer",
        displayPropsOfMeshesInScene,
      ),
    ).toEqual(displayPropsOfMeshesInScene);
  });
});
