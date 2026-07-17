import { DeleteOutlined, LoadingOutlined } from "@ant-design/icons";
import MipIcon from "@images/icons/icon-mip.svg?react";
import { Dropdown, type MenuProps } from "antd";
import { formatBytes } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { computeBoundingBoxFromArray } from "libs/utils";
import { useMemo } from "react";
import { useDispatch } from "react-redux";
import type { Vector6 } from "viewer/constants";
import {
  getByteCountFromLayer,
  getColorLayers,
  getMagInfoByLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  removeMipForBBoxAction,
  removeMipLayerForBBoxAction,
  setMipForBBoxAction,
} from "viewer/model/actions/annotation_actions";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import ButtonComponent from "../../components/button_component";

const RECOMMENDED_MIP_THRESHOLD_IN_BYTES = 50 * 1024 * 1024; // 50 MB

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
  const mipLayers = useWkSelector((state) => state.uiInformation.mipBBoxSettings[bboxId] ?? null);

  const activeMipLayerNames = new Set(mipLayers?.map((l) => l.layerName) ?? []);
  const availableColorLayers = colorLayers.filter((l) => !activeMipLayerNames.has(l.name));
  const bboxFromProps = useMemo(
    () => new BoundingBox(computeBoundingBoxFromArray(propValue)),
    [propValue],
  );
  const bBoxClampedToLayerBounds = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(colorLayers).map(([layerName, layer]) => [
          layerName,
          BoundingBox.fromBoundBoxObject(layer.boundingBox).intersectedWith(bboxFromProps),
        ]),
      ),
    [bboxFromProps, colorLayers],
  );

  const buildAutoSelectHandler = (layers: typeof colorLayers) => () => {
    for (const layer of layers) {
      const mags = magInfoByLayer[layer.name]?.getMagsWithIndices() ?? [];
      const bytesPerVoxel = getByteCountFromLayer(layer);

      let bestZoomStep: number | null = null;
      let bestSize = -1;
      let fallbackZoomStep: number | null = null;
      let fallbackSize = Number.MAX_SAFE_INTEGER;
      for (const [zoomStep, mag] of mags) {
        const [bboxW, bboxH, bboxD] = bBoxClampedToLayerBounds[layer.name].getSize();
        const voxels =
          Math.ceil(bboxW / mag[0]) * Math.ceil(bboxH / mag[1]) * Math.ceil(bboxD / mag[2]);
        const size = voxels * bytesPerVoxel;
        if (size <= RECOMMENDED_MIP_THRESHOLD_IN_BYTES && size > bestSize) {
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
        dispatch(setMipForBBoxAction(bboxId, { layerName: layer.name, zoomStep, isLoading: true }));
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
          const [bboxW, bboxH, bboxD] = bBoxClampedToLayerBounds[layer.name].getSize();
          const voxels =
            Math.ceil(bboxW / mag[0]) * Math.ceil(bboxH / mag[1]) * Math.ceil(bboxD / mag[2]);
          return {
            key: `mip-${layer.name}-${zoomStep}`,
            label: `Mag ${mag.join("-")} (${formatBytes(voxels * bytesPerVoxel, 0)})`,
            onClick: () => {
              dispatch(
                setMipForBBoxAction(bboxId, { layerName: layer.name, zoomStep, isLoading: true }),
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
                dispatch(removeMipLayerForBBoxAction(bboxId, l.layerName));
                onClose?.();
              },
            })),
            {
              key: "removeAllMip",
              label: "Remove all",
              icon: <DeleteOutlined />,
              onClick: () => {
                dispatch(removeMipForBBoxAction(bboxId));
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
  const mipLayers = useWkSelector((state) => state.uiInformation.mipBBoxSettings[bboxId] ?? null);
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
            onClick: () => dispatch(removeMipLayerForBBoxAction(bboxId, l.layerName)),
          })),
          {
            key: "removeAllMip",
            label: "Remove all MIP layers",
            icon: <DeleteOutlined />,
            onClick: () => dispatch(removeMipForBBoxAction(bboxId)),
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
            <LoadingOutlined style={{ color: "var(--ant-color-primary)" }} />
          ) : (
            <MipIcon style={{ color: "var(--ant-color-primary)" }} />
          )
        }
        onClick={(e) => e.stopPropagation()}
      />
    </Dropdown>
  );
}
