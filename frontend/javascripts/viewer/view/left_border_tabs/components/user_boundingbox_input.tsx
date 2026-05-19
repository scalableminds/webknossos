import {
  BorderInnerOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  FireOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import { Dropdown, Flex, Input, type MenuProps, Switch } from "antd";
import FastTooltip from "components/fast_tooltip";
import { formatBytes } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { numberArrayToVector6, rgbToHex, stringToNumberArray } from "libs/utils";
import messages from "messages";
import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import type { Vector3, Vector6 } from "viewer/constants";
import {
  getColorLayers,
  getMagInfoByLayer,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  removeMipForBboxAction,
  removeMipLayerForBboxAction,
  setMipForBboxAction,
} from "viewer/model/actions/annotation_actions";
import { api } from "viewer/singletons";
import ButtonComponent from "../../components/button_component";
import ColorSetting from "./color_setting";

type UserBoundingBoxInputProps = {
  bboxId: number;
  value: Vector6;
  name: string;
  color: Vector3;
  isVisible: boolean;
  isExportEnabled: boolean;
  onBoundingChange: (arg0: Vector6) => void;
  onDelete: () => void;
  onExport: () => void;
  onGoToBoundingBox: () => void;
  onVisibilityChange: (arg0: boolean) => void;
  onNameChange: (arg0: string) => void;
  onColorChange: (arg0: Vector3) => void;
  disabled: boolean;
  isLockedByOwner: boolean;
  isOwner: boolean;
  onOpenContextMenu: (
    menu: MenuProps,
    event: React.MouseEvent<HTMLDivElement>,
    bboxId: number,
  ) => void;
  onHideContextMenu?: () => void;
};

const FORMAT_TOOLTIP = "Format: minX, minY, minZ, width, height, depth";

function getBytesPerElement(elementClass: string): number {
  switch (elementClass) {
    case "uint8":
    case "int8":
      return 1;
    case "uint16":
    case "int16":
      return 2;
    case "uint24":
      return 3;
    case "uint32":
    case "int32":
    case "float":
      return 4;
    case "uint64":
    case "int64":
    case "double":
      return 8;
    default:
      return 1;
  }
}

export default function UserBoundingBoxInput(props: UserBoundingBoxInputProps) {
  const {
    bboxId,
    value: propValue,
    name: propName,
    color,
    isVisible,
    onDelete,
    onExport,
    isExportEnabled,
    onGoToBoundingBox,
    onVisibilityChange,
    onNameChange,
    onColorChange,
    disabled,
    isLockedByOwner,
    isOwner,
    onBoundingChange,
    onOpenContextMenu,
    onHideContextMenu,
  } = props;

  const dispatch = useDispatch();

  const [isEditing, setIsEditing] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const [text, setText] = useState(computeText(propValue));
  const [name, setName] = useState(propName);

  const visibleSegmentationLayer = useWkSelector((state) => getVisibleSegmentationLayer(state));
  const colorLayers = useWkSelector((state) => getColorLayers(state.dataset));
  const magInfoByLayer = useWkSelector((state) => getMagInfoByLayer(state.dataset));
  const mipLayers = useWkSelector((state) => state.mipBboxSettings[bboxId] ?? null);
  const isMipLoading = mipLayers?.some((l) => l.isLoading) ?? false;

  useEffect(() => {
    if (!isEditing && propValue !== undefined) {
      setIsValid(true);
      setText(computeText(propValue));
    }
  }, [propValue, isEditing]);

  useEffect(() => {
    if (propName !== undefined) {
      setName(propName);
    }
  }, [propName]);

  function computeText(vector: Vector6) {
    return vector.join(", ");
  }

  const handleBlur = () => {
    setIsEditing(false);
    setIsValid(true);
    setText(computeText(propValue));
  };

  const handleFocus = () => {
    setIsEditing(true);
    setText(computeText(propValue));
    setIsValid(true);
  };

  const handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const newText = evt.target.value;
    // only numbers, commas and whitespace is allowed
    const isValidInput = /^[\d\s,]*$/g.test(newText);
    const value = stringToNumberArray(newText);
    const isValidLength = value.length === 6;
    const isValid = isValidInput && isValidLength;

    if (isValid) {
      onBoundingChange(numberArrayToVector6(value));
    }

    setText(newText);
    setIsValid(isValid);
  };

  const handleColorChange = (newColor: Vector3) => {
    const mappedColor = newColor.map((colorPart) => colorPart / 255) as any as Vector3;
    onColorChange(mappedColor);
  };

  const handleNameChanged = (evt: React.SyntheticEvent) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const currentEnteredName = evt.target.value;

    if (currentEnteredName !== propName) {
      onNameChange(currentEnteredName);
    }
  };

  const maybeCloseContextMenu = () => {
    if (onHideContextMenu) {
      onHideContextMenu();
    }
  };

  const onRegisterSegmentsForBB = async (value: Vector6, name: string): Promise<void> => {
    const min: Vector3 = [value[0], value[1], value[2]];
    const max: Vector3 = [value[0] + value[3], value[1] + value[4], value[2] + value[5]];
    // Close before the async call to avoid that the user can easily click twice.
    maybeCloseContextMenu();
    await api.tracing
      .registerSegmentsForBoundingBox(min, max, name)
      .catch((error) => Toast.error(error.message));
  };

  const upscaledColor = color.map((colorPart) => colorPart * 255) as any as Vector3;
  const marginLeftStyle = {
    marginLeft: 6,
  };

  const editingDisallowedExplanation = messages["tracing.read_only_mode_notification"](
    isLockedByOwner,
    isOwner,
  );
  const exportDisallowedExplanation = isLockedByOwner
    ? editingDisallowedExplanation
    : "This WEBKNOSSOS instance is not configured to run export jobs.";

  const getContextMenu = () => {
    const activeMipLayerNames = new Set(mipLayers?.map((l) => l.layerName) ?? []);
    const availableColorLayers = colorLayers.filter((l) => !activeMipLayerNames.has(l.name));

    const buildAutoSelectHandler = (layers: typeof colorLayers) => () => {
      const MAX_BYTES = 50 * 1024 * 1024;
      const [, , , bboxW, bboxH, bboxD] = propValue;
      let bestLayerName: string | null = null;
      let bestZoomStep: number | null = null;
      let bestSize = -1;
      let fallbackLayerName: string | null = null;
      let fallbackZoomStep: number | null = null;
      let fallbackSize = Number.MAX_SAFE_INTEGER;
      for (const layer of layers) {
        const mags = magInfoByLayer[layer.name]?.getMagsWithIndices() ?? [];
        const bytesPerVoxel = getBytesPerElement(layer.elementClass);
        for (const [zoomStep, mag] of mags) {
          const voxels =
            Math.ceil(bboxW / mag[0]) * Math.ceil(bboxH / mag[1]) * Math.ceil(bboxD / mag[2]);
          const size = voxels * bytesPerVoxel;
          if (size <= MAX_BYTES && size > bestSize) {
            bestSize = size;
            bestLayerName = layer.name;
            bestZoomStep = zoomStep;
          }
          if (size < fallbackSize) {
            fallbackSize = size;
            fallbackLayerName = layer.name;
            fallbackZoomStep = zoomStep;
          }
        }
      }
      const layerName = bestLayerName ?? fallbackLayerName;
      const zoomStep = bestZoomStep ?? fallbackZoomStep;
      if (layerName != null && zoomStep != null) {
        dispatch(setMipForBboxAction(bboxId, { layerName, zoomStep, isLoading: true }));
        maybeCloseContextMenu();
      }
    };

    const renderAsMipItem: NonNullable<MenuProps["items"]>[number] = {
      key: "renderAsMip",
      label: "Render as MIP",
      icon: <FireOutlined />,
      disabled: availableColorLayers.length === 0,
      onTitleClick: buildAutoSelectHandler(availableColorLayers),
      children: availableColorLayers.map((layer) => {
        const mags = magInfoByLayer[layer.name]?.getMagsWithIndices() ?? [];
        const bytesPerVoxel = getBytesPerElement(layer.elementClass);
        const [, , , bboxW, bboxH, bboxD] = propValue;
        return {
          key: `mip-${layer.name}`,
          label: layer.name,
          children: mags.map(([zoomStep, mag]) => {
            const voxels =
              Math.ceil(bboxW / mag[0]) * Math.ceil(bboxH / mag[1]) * Math.ceil(bboxD / mag[2]);
            const sizeLabel = formatBytes(voxels * bytesPerVoxel, 0);
            return {
              key: `mip-${layer.name}-${zoomStep}`,
              label: `Mag ${mag.join("-")} (${sizeLabel})`,
              onClick: () => {
                dispatch(
                  setMipForBboxAction(bboxId, {
                    layerName: layer.name,
                    zoomStep,
                    isLoading: true,
                  }),
                );
                maybeCloseContextMenu();
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
            icon: <FireOutlined />,
            children: [
              ...mipLayers.map((l) => ({
                key: `removeMipLayer-${l.layerName}`,
                label: l.layerName,
                icon: <DeleteOutlined />,
                onClick: () => {
                  dispatch(removeMipLayerForBboxAction(bboxId, l.layerName));
                  maybeCloseContextMenu();
                },
              })),
              {
                key: "removeAllMip",
                label: "Remove all",
                icon: <DeleteOutlined />,
                onClick: () => {
                  dispatch(removeMipForBboxAction(bboxId));
                  maybeCloseContextMenu();
                },
              },
            ],
          }
        : null;

    const items: MenuProps["items"] = [
      renderAsMipItem,
      ...(activeMipLayersItem != null ? [activeMipLayersItem] : []),
      {
        key: "registerSegments",
        label: (
          <>
            Register all segments in this bounding box
            <FastTooltip title="Moves/registers all segments within this bounding box into a new segment group">
              <InfoCircleOutlined style={marginLeftStyle} />
            </FastTooltip>
          </>
        ),
        icon: <ScanOutlined />,
        onClick: () => onRegisterSegmentsForBB(propValue, name),
        disabled: visibleSegmentationLayer == null || disabled,
      },
      {
        key: "goToCenter",
        label: "Go to center",
        icon: <BorderInnerOutlined />,
        onClick: onGoToBoundingBox,
      },
      {
        key: "export",
        icon: <DownloadOutlined />,
        label: isExportEnabled ? (
          "Export data"
        ) : (
          <FastTooltip title={exportDisallowedExplanation}>Export data</FastTooltip>
        ),
        disabled: !isExportEnabled,
        onClick: onExport,
      },
    ];

    return { items };
  };

  return (
    <div
      onContextMenu={(evt) => onOpenContextMenu(getContextMenu(), evt, bboxId)}
      onClick={onHideContextMenu}
    >
      <Flex
        gap="middle"
        justify="flex-start"
        style={{
          marginTop: 10,
          marginBottom: 10,
        }}
      >
        <Flex gap="middle" justify="space-between" align="center">
          <Switch
            size="small"
            onChange={onVisibilityChange}
            checked={isVisible}
            // To prevent centering the bounding box on every edit (e.g. upon visibility change)
            // the click events are stopped from propagating to the parent div.
            onClick={(_value, e) => e.stopPropagation()}
          />
          <FastTooltip title={disabled ? editingDisallowedExplanation : null}>
            <ColorSetting
              value={rgbToHex(upscaledColor)}
              onChange={handleColorChange}
              disabled={disabled}
            />
          </FastTooltip>
        </Flex>
        <FastTooltip title={disabled ? editingDisallowedExplanation : null} style={{ flexGrow: 1 }}>
          <Input
            defaultValue={name}
            placeholder="Bounding Box Name"
            size="small"
            value={name}
            onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
              setName(evt.target.value);
            }}
            onPressEnter={handleNameChanged}
            onBlur={handleNameChanged}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
          />
        </FastTooltip>
        {mipLayers != null && mipLayers.length > 0 && (
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
                  <FireOutlined style={{ color: "#1677ff" }} />
                )
              }
              onClick={(e) => e.stopPropagation()}
            />
          </Dropdown>
        )}
        <ButtonComponent
          title={disabled ? editingDisallowedExplanation : "Delete Bounding Box"}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={disabled}
          icon={<DeleteOutlined />}
          type="text"
          size="small"
        />
      </Flex>
      <Flex
        style={{
          marginBottom: 10,
        }}
        align="flex-start"
        gap="middle"
        justify="flex-start"
      >
        <FastTooltip
          style={{ flex: "0 0 60px" }}
          title="The top-left corner of the bounding box followed by the width, height, and depth."
        >
          <label> Bounds: </label>
        </FastTooltip>
        <FastTooltip
          title={disabled ? editingDisallowedExplanation : FORMAT_TOOLTIP}
          placement="top-start"
          style={{ flexGrow: 1 }}
        >
          <Input
            status={isValid ? "" : "error"}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            value={text}
            placeholder="0, 0, 0, 512, 512, 512"
            size="small"
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
          />
        </FastTooltip>
        {/* onOpenContextMenu needs event from div*/}
        <div onClick={(evt) => onOpenContextMenu(getContextMenu(), evt, bboxId)}>
          <ButtonComponent type="text" size="small" icon={<EllipsisOutlined />} />
        </div>
      </Flex>
    </div>
  );
}
