import { AimOutlined } from "@ant-design/icons";
import { Modal, Select } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useState } from "react";
import {
  getFlatTreeGroups,
  getSkeletonTracing,
} from "viewer/model/accessors/skeletontracing_accessor";
import ButtonComponent from "viewer/view/components/button_component";
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

function LandmarkTransformModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const layers = useWkSelector((state) => state.dataset.dataSource.dataLayers);
  const skeletonTracing = useWkSelector((state) => getSkeletonTracing(state.annotation));
  const treeGroups = skeletonTracing ? Array.from(getFlatTreeGroups(skeletonTracing)) : [];

  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [sourceGroup, setSourceGroup] = useState<number | null>(null);
  const [targetGroup, setTargetGroup] = useState<number | null>(null);

  const layerOptions = layers.map((l) => ({ label: l.name, value: l.name }));
  const groupOptions = treeGroups.map((g) => ({ label: g.name, value: g.groupId }));

  return (
    <Modal
      title="Landmark-Based Transform"
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText="Apply"
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
      </div>
    </Modal>
  );
}
