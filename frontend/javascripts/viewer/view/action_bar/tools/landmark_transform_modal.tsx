import { AimOutlined } from "@ant-design/icons";
import { Alert, Modal, Select } from "antd";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import type { Matrix4x4 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { AffineTransformation, CoordinateTransformation } from "types/api_types";
import { getDatasetBoundingBox } from "viewer/model/accessors/dataset_accessor";
import {
  buildLiveTransforms,
  flatToNestedMatrix,
  fromCenterToOrigin,
  fromOriginToCenter,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  getFlatTreeGroups,
  getSkeletonTracing,
} from "viewer/model/accessors/skeletontracing_accessor";
import { setLayerTransformsAction } from "viewer/model/actions/dataset_actions";
import { setNodePositionAction } from "viewer/model/actions/skeletontracing_actions";
import type { Tree } from "viewer/model/types/tree_types";
import ButtonComponent from "viewer/view/components/button_component";
import { createGroupToTreesMap } from "viewer/view/right_border_tabs/trees_tab/tree_hierarchy_view_helpers";
import { NARROW_BUTTON_STYLE } from "./tool_helpers";

export function LandmarkTransformButton() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <ButtonComponent
        style={NARROW_BUTTON_STYLE}
        title="Configure landmark-based layer transform"
        icon={<AimOutlined />}
        onClick={() => setIsOpen(true)}
      />
      <LandmarkTransformModal open={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

function nestedToThreeMatrix(t: AffineTransformation): Matrix4 {
  const m = t.matrix;
  return new Matrix4().set(
    m[0][0],
    m[0][1],
    m[0][2],
    m[0][3],
    m[1][0],
    m[1][1],
    m[1][2],
    m[1][3],
    m[2][0],
    m[2][1],
    m[2][2],
    m[2][3],
    m[3][0],
    m[3][1],
    m[3][2],
    m[3][3],
  );
}

function composeAffines(transforms: AffineTransformation[]): Matrix4 {
  const result = new Matrix4();
  for (const t of transforms) {
    result.premultiply(nestedToThreeMatrix(t));
  }
  return result;
}

function affineToLayerTransforms(
  affineFlat: Matrix4x4,
  datasetBboxArg: ReturnType<typeof getDatasetBoundingBox>,
): CoordinateTransformation[] {
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

  // Strip center matrices to isolate the inner SRT part
  const T0 = nestedToThreeMatrix(fromCenterToOrigin(datasetBboxArg));
  const T6 = nestedToThreeMatrix(fromOriginToCenter(datasetBboxArg));
  const inner = new Matrix4()
    .copy(T6)
    .invert()
    .multiply(A)
    .multiply(new Matrix4().copy(T0).invert());

  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  inner.decompose(position, quaternion, scale);

  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  const rotDeg: [number, number, number] = [
    (euler.x * 180) / Math.PI,
    (euler.y * 180) / Math.PI,
    (euler.z * 180) / Math.PI,
  ];
  const scaleArr: [number, number, number] = [scale.x, scale.y, scale.z];
  const transArr: [number, number, number] = [position.x, position.y, position.z];

  const rebuilt = buildLiveTransforms(datasetBboxArg, scaleArr, rotDeg, transArr);
  const rebuiltMat = composeAffines(rebuilt);
  const maxDiff = Math.max(...A.elements.map((v, i) => Math.abs(v - rebuiltMat.elements[i])));

  if (maxDiff < 1e-4) {
    return rebuilt;
  }
  return [{ type: "affine", matrix: flatToNestedMatrix(affineFlat) }];
}

function getSortedTrees(groupId: number, groupToTrees: Record<number, Tree[]>): Tree[] {
  const trees = groupToTrees[groupId] ?? [];
  return [...trees].sort((a, b) => a.name.localeCompare(b.name));
}

function LandmarkTransformModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);
  const layers = useWkSelector((state) => state.dataset.dataSource.dataLayers);
  const skeletonTracing = useWkSelector((state) => getSkeletonTracing(state.annotation));
  const treeGroups = skeletonTracing ? Array.from(getFlatTreeGroups(skeletonTracing)) : [];

  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [sourceGroup, setSourceGroup] = useState<number | null>(null);
  const [targetGroup, setTargetGroup] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const groupToTrees = useMemo(
    () => (skeletonTracing ? createGroupToTreesMap(skeletonTracing.trees) : {}),
    [skeletonTracing],
  );

  const validationError = useMemo(() => {
    if (!selectedLayer || sourceGroup == null || targetGroup == null) return null;
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
  }, [selectedLayer, sourceGroup, targetGroup, groupToTrees]);

  const handleApply = () => {
    if (selectedLayer == null || sourceGroup == null || targetGroup == null || validationError)
      return;

    const srcTrees = getSortedTrees(sourceGroup, groupToTrees);
    const tgtTrees = getSortedTrees(targetGroup, groupToTrees);

    const sourcePoints = srcTrees.map((t) => t.nodes.values().next().value!.untransformedPosition);
    const targetPoints = tgtTrees.map((t) => t.nodes.values().next().value!.untransformedPosition);

    setIsLoading(true);
    try {
      const affineFlat = estimateAffineMatrix4x4(sourcePoints, targetPoints);
      const datasetBbox = getDatasetBoundingBox(dataset);
      const newTransforms = affineToLayerTransforms(affineFlat, datasetBbox);
      dispatch(setLayerTransformsAction(selectedLayer, newTransforms));

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

  const layerOptions = layers.map((l) => ({ label: l.name, value: l.name }));
  const groupOptions = treeGroups.map((g) => ({ label: g.name, value: g.groupId }));

  return (
    <Modal
      title="Landmark-Based Transform"
      open={open}
      onCancel={onClose}
      onOk={handleApply}
      okText="Apply"
      okButtonProps={{ disabled: !!validationError || isLoading, loading: isLoading }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
        <div>
          <label style={{ display: "block", marginBottom: 4 }}>Layer</label>
          <Select
            style={{ width: "100%" }}
            placeholder="Select a layer"
            options={layerOptions}
            value={selectedLayer}
            onChange={setSelectedLayer}
          />
        </div>
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
