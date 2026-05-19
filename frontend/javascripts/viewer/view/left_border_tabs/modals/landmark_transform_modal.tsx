import { Alert, Modal, Select } from "antd";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import type { LandmarkPositionStore } from "libs/landmark_position_store";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { Matrix4, Vector3 } from "three";
import type { Vector3 as WkVector3 } from "viewer/constants";
import { getDatasetBoundingBox } from "viewer/model/accessors/dataset_accessor";
import { applyAffineOnTopOfTransforms } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  getFlatTreeGroups,
  getSkeletonTracing,
} from "viewer/model/accessors/skeletontracing_accessor";
import { setLayerTransformsAction } from "viewer/model/actions/dataset_actions";
import { setNodePositionAction } from "viewer/model/actions/skeletontracing_actions";
import type { Tree } from "viewer/model/types/tree_types";
import { createGroupToTreesMap } from "viewer/view/right_border_tabs/trees_tab/tree_hierarchy_view_helpers";

// If all source points share the same coordinate along one axis the 3-D affine
// system is degenerate. Fix it by duplicating every pair with a unit offset along
// that axis — the duplicated target is shifted by the same amount, so the solver
// learns "identity" for that direction.
function augmentIfCoplanar(
  src: WkVector3[],
  tgt: WkVector3[],
): { src: WkVector3[]; tgt: WkVector3[] } {
  for (const axis of [0, 1, 2] as const) {
    const vals = src.map((p) => p[axis]);
    if (Math.max(...vals) - Math.min(...vals) < 1e-6) {
      const shift = (p: WkVector3): WkVector3 => {
        const q = [...p] as WkVector3;
        q[axis] += 1;
        return q;
      };
      return { src: [...src, ...src.map(shift)], tgt: [...tgt, ...tgt.map(shift)] };
    }
  }
  return { src, tgt };
}

function getSortedTrees(groupId: number, groupToTrees: Record<number, Tree[]>): Tree[] {
  const trees = groupToTrees[groupId] ?? [];
  return [...trees].sort((a, b) => a.name.localeCompare(b.name));
}

export function LandmarkTransformModal({
  open,
  onClose,
  layerName,
  landmarkStore,
}: {
  open: boolean;
  onClose: () => void;
  layerName: string;
  landmarkStore: LandmarkPositionStore;
}) {
  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);
  const skeletonTracing = useWkSelector((state) => getSkeletonTracing(state.annotation));
  const treeGroups = skeletonTracing ? Array.from(getFlatTreeGroups(skeletonTracing)) : [];

  const [sourceGroup, setSourceGroup] = useState<number | null>(null);
  const [targetGroup, setTargetGroup] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const groupToTrees = useMemo(
    () => (skeletonTracing ? createGroupToTreesMap(skeletonTracing.trees) : {}),
    [skeletonTracing],
  );

  const validationError = useMemo(() => {
    if (sourceGroup == null || targetGroup == null) return null;
    if (sourceGroup === targetGroup) return "Source and target groups must be different.";
    const srcTrees = getSortedTrees(sourceGroup, groupToTrees);
    const tgtTrees = getSortedTrees(targetGroup, groupToTrees);
    if (srcTrees.length < 3) return "Need at least 3 landmark pairs.";
    if (srcTrees.length !== tgtTrees.length)
      return "Source and target groups must have the same number of trees.";
    if (srcTrees.some((t) => t.nodes.size() !== 1))
      return "Each source tree must contain exactly one node.";
    if (tgtTrees.some((t) => t.nodes.size() !== 1))
      return "Each target tree must contain exactly one node.";
    return null;
  }, [sourceGroup, targetGroup, groupToTrees]);

  const handleApply = () => {
    if (sourceGroup == null || targetGroup == null || validationError) return;

    const srcTrees = getSortedTrees(sourceGroup, groupToTrees);
    const tgtTrees = getSortedTrees(targetGroup, groupToTrees);

    const sourcePoints = srcTrees.map((t) => t.nodes.values().next().value!.untransformedPosition);
    const targetPoints = tgtTrees.map((t) => t.nodes.values().next().value!.untransformedPosition);

    setIsLoading(true);
    try {
      const { src: augSrc, tgt: augTgt } = augmentIfCoplanar(sourcePoints, targetPoints);
      const affineFlat = estimateAffineMatrix4x4(augSrc, augTgt);
      const datasetBbox = getDatasetBoundingBox(dataset);
      const currentTransforms =
        dataset.dataSource.dataLayers.find((l) => l.name === layerName)
          ?.coordinateTransformations ?? [];
      const newTransforms = applyAffineOnTopOfTransforms(
        currentTransforms,
        affineFlat,
        datasetBbox,
      );
      dispatch(setLayerTransformsAction(layerName, newTransforms));

      // Snapshot original positions before moving nodes so they can be restored on reset
      landmarkStore.snapshot(
        layerName,
        srcTrees.map((tree) => {
          const node = tree.nodes.values().next().value!;
          return { nodeId: node.id, treeId: tree.treeId, position: node.untransformedPosition };
        }),
      );

      // Move source nodes to their transformed positions so they track the layer
      const A = new Matrix4().set(
        affineFlat[0],
        affineFlat[1],
        affineFlat[2],
        affineFlat[3],
        affineFlat[4],
        affineFlat[5],
        affineFlat[6],
        affineFlat[7],
        affineFlat[8],
        affineFlat[9],
        affineFlat[10],
        affineFlat[11],
        affineFlat[12],
        affineFlat[13],
        affineFlat[14],
        affineFlat[15],
      );
      for (const tree of srcTrees) {
        const node = tree.nodes.values().next().value!;
        const p = new Vector3(...node.untransformedPosition).applyMatrix4(A);
        dispatch(setNodePositionAction([p.x, p.y, p.z], node.id, tree.treeId));
      }

      onClose();
    } catch (_e) {
      Toast.error("Failed to estimate transform. Please check your landmarks.");
    } finally {
      setIsLoading(false);
    }
  };

  const groupOptions = treeGroups.map((g) => ({ label: g.name, value: g.groupId }));

  return (
    <Modal
      title={`Landmark-Based Transform – ${layerName}`}
      open={open}
      onCancel={onClose}
      onOk={handleApply}
      okText="Apply"
      okButtonProps={{ disabled: !!validationError || isLoading, loading: isLoading }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
        <div>
          <label style={{ display: "block", marginBottom: 4 }}>
            Source Landmarks (skeleton group)
          </label>
          <Select
            style={{ width: "100%" }}
            placeholder="Select skeleton group"
            options={groupOptions}
            value={sourceGroup}
            onChange={setSourceGroup}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 4 }}>
            Target Landmarks (skeleton group)
          </label>
          <Select
            style={{ width: "100%" }}
            placeholder="Select skeleton group"
            options={groupOptions}
            value={targetGroup}
            onChange={setTargetGroup}
          />
        </div>
        {validationError && <Alert type="error" message={validationError} showIcon />}
      </div>
    </Modal>
  );
}
