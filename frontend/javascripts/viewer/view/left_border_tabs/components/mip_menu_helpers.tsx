import { DeleteOutlined, LoadingOutlined } from "@ant-design/icons";
import MipIcon from "@images/icons/icon-MIP.svg?react";
import { Dropdown, type MenuProps } from "antd";
import { formatBytes } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import type { Vector6 } from "viewer/constants";
import {
  getByteCountFromLayer,
  getColorLayers,
  getMagInfoByLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  removeMipForBboxAction,
  removeMipLayerForBboxAction,
  setMipForBboxAction,
} from "viewer/model/actions/annotation_actions";
import ButtonComponent from "../../components/button_component";

const MAX_MIP_BYTES = 50 * 1024 * 1024;

// Returns the MIP-related context menu items:
// - "Render as MIP" submenu (per layer → per mag, with byte-size labels)
// - "Active MIP layers" submenu for removing individual layers or all at once
export function useMipContextMenuItems(
  bboxId: number,
  propValue: Vector6,
  onClose?: () => void,
): NonNullable<MenuProps["items"]> {
  const dispatch = useDispatch();
  const colorLayers = useWkSelector((state) => getColorLayers(state.dataset));
  const magInfoByLayer = useWkSelector((state) => getMagInfoByLayer(state.dataset));
  const mipLayers = useWkSelector((state) => state.mipBboxSettings[bboxId] ?? null);

  const activeMipLayerNames = new Set(mipLayers?.map((l) => l.layerName) ?? []);
  const availableColorLayers = colorLayers.filter((l) => !activeMipLayerNames.has(l.name));
  const [, , , bboxW, bboxH, bboxD] = propValue;

  const buildAutoSelectHandler = (layers: typeof colorLayers) => () => {
    for (const layer of layers) {
      const mags = magInfoByLayer[layer.name]?.getMagsWithIndices() ?? [];
      const bytesPerVoxel = getByteCountFromLayer(layer);
      let bestZoomStep: number | null = null;
      let bestSize = -1;
      let fallbackZoomStep: number | null = null;
      let fallbackSize = Number.MAX_SAFE_INTEGER;
      for (const [zoomStep, mag] of mags) {
        const voxels =
          Math.ceil(bboxW / mag[0]) * Math.ceil(bboxH / mag[1]) * Math.ceil(bboxD / mag[2]);
        const size = voxels * bytesPerVoxel;
        if (size <= MAX_MIP_BYTES && size > bestSize) {
          bestSize = size;
          bestZoomStep = zoomStep;
        }
        if (size < fallbackSize) {
          fallbackSize = size;
          fallbackZoomStep = zoomStep;
        }
      }
      const zoomStep = bestZoomStep ?? fallbackZoomStep;
      if (zoomStep != null) {
        dispatch(setMipForBboxAction(bboxId, { layerName: layer.name, zoomStep, isLoading: true }));
      }
    }
    onClose?.();
  };

  const renderAsMipItem: NonNullable<MenuProps["items"]>[number] = {
    key: "renderAsMip",
    label: "Render as MIP",
    icon: <MipIcon />,
    disabled: availableColorLayers.length === 0,
    onTitleClick: buildAutoSelectHandler(availableColorLayers),
    children: availableColorLayers.map((layer) => {
      const mags = magInfoByLayer[layer.name]?.getMagsWithIndices() ?? [];
      const bytesPerVoxel = getByteCountFromLayer(layer);
      return {
        key: `mip-${layer.name}`,
        label: layer.name,
        children: mags.map(([zoomStep, mag]) => {
          const voxels =
            Math.ceil(bboxW / mag[0]) * Math.ceil(bboxH / mag[1]) * Math.ceil(bboxD / mag[2]);
          return {
            key: `mip-${layer.name}-${zoomStep}`,
            label: `Mag ${mag.join("-")} (${formatBytes(voxels * bytesPerVoxel, 0)})`,
            onClick: () => {
              dispatch(
                setMipForBboxAction(bboxId, { layerName: layer.name, zoomStep, isLoading: true }),
              );
              onClose?.();
            },
          };
        }),
      };
    }),
  };

  const activeMipLayersItem: NonNullable<MenuProps["items"]>[number] | null =
    mipLayers != null && mipLayers.length > 0
      ? {
          key: "mipLayers",
          label: "Active MIP layers",
          icon: <MipIcon />,
          children: [
            ...mipLayers.map((l) => ({
              key: `removeMipLayer-${l.layerName}`,
              label: l.layerName,
              icon: <DeleteOutlined />,
              onClick: () => {
                dispatch(removeMipLayerForBboxAction(bboxId, l.layerName));
                onClose?.();
              },
            })),
            {
              key: "removeAllMip",
              label: "Remove all",
              icon: <DeleteOutlined />,
              onClick: () => {
                dispatch(removeMipForBboxAction(bboxId));
                onClose?.();
              },
            },
          ],
        }
      : null;

  return [renderAsMipItem, ...(activeMipLayersItem != null ? [activeMipLayersItem] : [])];
}

// Inline dropdown button showing active MIP layers. Renders nothing when no layers are active.
export function MipInlineButton({ bboxId }: { bboxId: number }) {
  const dispatch = useDispatch();
  const mipLayers = useWkSelector((state) => state.mipBboxSettings[bboxId] ?? null);
  const isMipLoading = mipLayers?.some((l) => l.isLoading) ?? false;

  if (mipLayers == null || mipLayers.length === 0) return null;

  return (
    <Dropdown
      menu={{
        items: [
          ...mipLayers.map((l) => ({
            key: `removeMipLayer-${l.layerName}`,
            label: l.layerName,
            icon: <DeleteOutlined />,
            onClick: () => dispatch(removeMipLayerForBboxAction(bboxId, l.layerName)),
          })),
          {
            key: "removeAllMip",
            label: "Remove all MIP layers",
            icon: <DeleteOutlined />,
            onClick: () => dispatch(removeMipForBboxAction(bboxId)),
          },
        ],
      }}
      trigger={["click"]}
    >
      <ButtonComponent
        type="text"
        size="small"
        title={`MIP: ${mipLayers.map((l) => l.layerName).join(", ")}`}
        icon={
          isMipLoading ? (
            <LoadingOutlined style={{ color: "#1677ff" }} />
          ) : (
            <MipIcon style={{ color: "#1677ff" }} />
          )
        }
        onClick={(e) => e.stopPropagation()}
      />
    </Dropdown>
  );
}
