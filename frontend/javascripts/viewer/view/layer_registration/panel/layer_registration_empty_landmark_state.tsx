import { CopyOutlined } from "@ant-design/icons";
import { Card, Flex, Select, Space, Typography, theme } from "antd";
import { AsyncButton } from "components/async_clickables";
import { pluralize } from "libs/utils";
import type React from "react";
import { useState } from "react";
import type { LayerNames } from "../helpers/layer_registration_helpers";
import type { CopySource } from "../helpers/layer_registration_moving_layers";
import { MIN_LANDMARK_PAIR_COUNT } from "../helpers/layer_registration_transform_estimation";

// Offers to start the active moving layer with the fixed layer landmarks of another moving
// layer. The right view then asks for the partner of each of them.
function CopyLandmarksOffer({
  fixedLayerName,
  sources,
  onCopy,
}: {
  fixedLayerName: string;
  sources: CopySource[];
  onCopy: (sourceLayerName: string) => Promise<void>;
}) {
  const [sourceLayerName, setSourceLayerName] = useState<string | null>(null);
  const selectedSource =
    sources.find((source) => source.layerName === sourceLayerName) ?? sources[0];
  if (selectedSource == null) {
    return null;
  }
  return (
    <Card
      size="small"
      title={
        <Typography.Text strong>
          <CopyOutlined /> Or reuse landmarks of another layer
        </Typography.Text>
      }
    >
      <Flex vertical gap={8}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Copies the {fixedLayerName} landmarks of that layer. The right view then asks for the
          partner of each one.
        </Typography.Text>
        <Space.Compact block>
          <Select
            value={selectedSource.layerName}
            onChange={setSourceLayerName}
            options={sources.map(({ layerName, landmarkCount }) => ({
              value: layerName,
              label: `${layerName} · ${landmarkCount} ${pluralize("landmark", landmarkCount)}`,
            }))}
            // Takes the width that the button leaves free.
            style={{ flex: 1, minWidth: 0 }}
          />
          <AsyncButton onClick={() => onCopy(selectedSource.layerName)}>Copy</AsyncButton>
        </Space.Compact>
      </Flex>
    </Card>
  );
}

function StepNumber({ children }: { children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: `1px solid ${token.colorBorder}`,
        fontSize: 11,
        fontWeight: token.fontWeightStrong,
      }}
    >
      {children}
    </span>
  );
}

// Shown instead of the landmark table while the active moving layer has no landmarks.
export function EmptyLandmarkState({
  layerNames,
  copySources,
  onCopyLandmarks,
}: {
  layerNames: LayerNames;
  copySources: CopySource[];
  onCopyLandmarks: (sourceLayerName: string) => Promise<void>;
}) {
  const steps = [
    `Click a clear structure in the left view (${layerNames.fixed}).`,
    `Click the same structure in the right view (${layerNames.moving}).`,
    `Repeat. From ${MIN_LANDMARK_PAIR_COUNT} pairs on, the right view shows the transformed result. Spread the pairs out in x, y and z.`,
  ];
  return (
    <Flex vertical gap={16}>
      <Flex vertical gap={10}>
        <Typography.Text strong>How to place landmarks</Typography.Text>
        {steps.map((step, index) => (
          <Flex key={step} gap={10} align="start">
            <StepNumber>{index + 1}</StepNumber>
            <Typography.Text>{step}</Typography.Text>
          </Flex>
        ))}
      </Flex>
      <CopyLandmarksOffer
        fixedLayerName={layerNames.fixed}
        sources={copySources}
        onCopy={onCopyLandmarks}
      />
    </Flex>
  );
}
