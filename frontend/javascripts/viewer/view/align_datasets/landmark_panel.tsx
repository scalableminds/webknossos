import { EyeOutlined } from "@ant-design/icons";
import { Button, Space, Table, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Vector3 } from "viewer/constants";
import type { Transform } from "viewer/model/helpers/transformation_helpers";
import {
  getLandmarkPairs,
  type Landmark,
  type LandmarkPair,
  type LayerNames,
  OTHER_SIDE,
  SIDES,
  type Side,
} from "./alignment_helpers";

type Props = {
  layerNames: LayerNames;
  landmarks: Record<Side, Landmark[]>;
  transformBtoA: Transform | null;
  isOtherLayerVisible: Record<Side, boolean>;
  canStoreAlignment: boolean;
  onToggleOtherLayer: (side: Side) => void;
  onResetAlignment: () => void;
  onStoreAlignment: () => void;
  onFocusLandmark: (side: Side, position: Vector3) => void;
};

function rgbColorString(color: Vector3): string {
  return `rgb(${color.map((component) => Math.round(component * 255)).join(",")})`;
}

function LandmarkCell({ landmark, onFocus }: { landmark?: Landmark; onFocus: () => void }) {
  if (landmark == null) {
    return "–";
  }
  return (
    <span>
      <span className="landmark-color" style={{ background: rgbColorString(landmark.color) }} />
      {landmark.position.join(", ")} <EyeOutlined onClick={onFocus} />
    </span>
  );
}

function getColumns(
  layerNames: LayerNames,
  onFocusLandmark: Props["onFocusLandmark"],
): ColumnsType<LandmarkPair> {
  const landmarkColumns = SIDES.map((side) => ({
    title: layerNames[side],
    key: side,
    align: "center" as const,
    render: (_value: unknown, pair: LandmarkPair) => {
      const landmark = pair.landmarks[side];
      return (
        <LandmarkCell
          landmark={landmark}
          onFocus={() => landmark != null && onFocusLandmark(side, landmark.position)}
        />
      );
    },
  }));
  return [
    {
      title: "#",
      key: "index",
      width: 32,
      render: (_value, _pair, index) => index + 1,
    },
    ...landmarkColumns,
    {
      title: "Error",
      key: "residual",
      width: 56,
      align: "center",
      render: (_value, pair) => (pair.residual != null ? pair.residual.toFixed(1) : "–"),
    },
  ];
}

export function LandmarkPanel({
  layerNames,
  landmarks,
  transformBtoA,
  isOtherLayerVisible,
  canStoreAlignment,
  onToggleOtherLayer,
  onResetAlignment,
  onStoreAlignment,
  onFocusLandmark,
}: Props) {
  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="small">
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Fixed <b>{layerNames.A}</b> &nbsp;→&nbsp; moving <b>{layerNames.B}</b>
      </Typography.Text>
      <Space size={4} wrap>
        {SIDES.map((side) => (
          <Tooltip
            key={side}
            title={`Show/hide "${layerNames[OTHER_SIDE[side]]}" in the ${layerNames[side]} view (x)`}
          >
            <Button
              size="small"
              type={isOtherLayerVisible[side] ? "primary" : "default"}
              onClick={() => onToggleOtherLayer(side)}
            >
              Overlay in {layerNames[side]}
            </Button>
          </Tooltip>
        ))}
      </Space>
      <Space size={4} wrap>
        <Tooltip title="Drop the current alignment and show both layers untransformed again">
          <Button size="small" onClick={onResetAlignment}>
            Reset
          </Button>
        </Tooltip>
        <Tooltip
          title={`Store the current alignment as "${layerNames.B}"'s default transform in the dataset`}
        >
          <Button
            size="small"
            onClick={onStoreAlignment}
            disabled={transformBtoA == null || !canStoreAlignment}
          >
            Store as Default
          </Button>
        </Tooltip>
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        While a view has keyboard focus: <b>t</b> aligns, <b>x</b> toggles the other layer in that
        view, <b>y</b> syncs the other view to that view's position.
      </Typography.Text>
      <Table<LandmarkPair>
        size="small"
        pagination={false}
        columns={getColumns(layerNames, onFocusLandmark)}
        dataSource={getLandmarkPairs(landmarks, transformBtoA)}
        scroll={{ x: "max-content" }}
      />
    </Space>
  );
}
