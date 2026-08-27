import Icon, { DownloadOutlined, FileTextOutlined, MoreOutlined } from "@ant-design/icons";
import IconStatusbarDownsampling from "@images/icons/icon-statusbar-downsampling.svg?react";
import IconStatusbarMouseLeft from "@images/icons/icon-statusbar-mouse-left.svg?react";
import IconStatusbarMouseLeftDrag from "@images/icons/icon-statusbar-mouse-left-drag.svg?react";
import IconStatusbarMouseRight from "@images/icons/icon-statusbar-mouse-right.svg?react";
import IconStatusbarMouseRightDrag from "@images/icons/icon-statusbar-mouse-right-drag.svg?react";
import IconStatusbarMouseWheel from "@images/icons/icon-statusbar-mouse-wheel.svg?react";
import { Popover, Space, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useInterval } from "libs/react_helpers";
import { useKeyPress, useWkSelector } from "libs/react_hooks";
import messages from "messages";
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { AltOrOptionKey, MappingStatusEnum, OrthoViews } from "viewer/constants";
import {
  type ActionDescriptor,
  getToolControllerForAnnotationTool,
} from "viewer/controller/combinations/tool_controls";
import {
  getMappingInfoOrNull,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { getActiveMagInfo } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool, adaptActiveToolToShortcuts } from "viewer/model/accessors/tool_accessor";
import {
  getGlobalMousePosition,
  isPlaneMode as getIsPlaneMode,
} from "viewer/model/accessors/view_mode_accessor";
import {
  getActiveSegmentationTracing,
  getReadableNameForLayerName,
  getSegmentationLayerForTracing,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  setActiveNodeAction,
  setActiveTreeAction,
} from "viewer/model/actions/skeletontracing_actions";
import { setActiveCellAction } from "viewer/model/actions/volumetracing_actions";
import { getSegmentIdRangeForElementClass } from "viewer/model/bucket_data_handling/data_rendering_logic";
import { getGlobalDataConnectionInfo } from "viewer/model/data_connection_info";
import { Store } from "viewer/singletons";
import BorderToggleButton from "./components/border_toggle_button";
import { NumberInputPopoverSetting } from "./left_border_tabs/components/number_input_popover_setting";

const { Text } = Typography;

const lineColor = "rgba(255, 255, 255, 0.67)";
const moreIconStyle = {
  height: 14,
  color: lineColor,
};
// Keeps a visible gap between the (right-aligned) shortcut hints and Infos, matching
// the existing spacing convention of .info-element/.shortcut-info-element.
const MIN_GAP_BEFORE_INFOS = 20;

type ShortcutItem = {
  key: string;
  node: React.ReactNode;
};

function getPosString(
  pos: Vector3,
  optAdditionalCoordinates: AdditionalCoordinate[] | null | undefined,
) {
  const additionalCoordinates = (optAdditionalCoordinates || []).map((coord) => coord.value);
  return V3.floor(pos).concat(additionalCoordinates).join(",");
}

function getZoomShortcutItem(): ShortcutItem {
  return {
    key: "zoom",
    node: (
      <span className="shortcut-info-element">
        <Text keyboard>{AltOrOptionKey}</Text>
        +
        <Icon component={IconStatusbarMouseWheel} aria-label="Mouse Wheel" /> Zoom in/out
      </span>
    ),
  };
}

function getLeftClickItems(actionDescriptor: ActionDescriptor): ShortcutItem[] {
  const items: ShortcutItem[] = [];
  if (actionDescriptor.leftClick != null) {
    items.push({
      key: "left-click",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon component={IconStatusbarMouseLeft} aria-label="Mouse Left Click" />
          {actionDescriptor.leftClick}
        </Space>
      ),
    });
  }
  if (actionDescriptor.leftDrag != null) {
    items.push({
      key: "left-drag",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon
            className="statusbar-drag-icon"
            component={IconStatusbarMouseLeftDrag}
            aria-label="Mouse Left Drag"
          />
          {actionDescriptor.leftDrag}
        </Space>
      ),
    });
  }
  return items;
}

function getRightClickItems(actionDescriptor: ActionDescriptor): ShortcutItem[] {
  const items: ShortcutItem[] = [];
  if (actionDescriptor.rightClick != null) {
    items.push({
      key: "right-click",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon component={IconStatusbarMouseRight} aria-label="Mouse Right Click" />
          {actionDescriptor.rightClick}
        </Space>
      ),
    });
  }
  if (actionDescriptor.rightDrag != null) {
    items.push({
      key: "right-drag",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon
            className="statusbar-drag-icon"
            component={IconStatusbarMouseRightDrag}
            aria-label="Mouse Right Drag"
          />
          {actionDescriptor.rightDrag}
        </Space>
      ),
    });
  }
  return items;
}

function getMoreShortcutsItems(): ShortcutItem[] {
  return [
    {
      key: "commands",
      node: (
        <div className="shortcut-info-element">
          <Text keyboard>Ctrl + P</Text> Commands
        </div>
      ),
    },
    {
      key: "more-link",
      node: moreShortcutsLink,
    },
  ];
}

// Note: this item's spacing (and that of the "commands" item above) relies on the
// scoped `.statusbar .shortcut-info-element` CSS rule, which only applies to elements
// that are actual DOM descendants of `.statusbar`. When shown inside the "More" popover
// (which antd renders into a portal outside of `.statusbar`), that rule doesn't apply,
// so these items render flush-left there instead of picking up stray margin.
const moreShortcutsLink = (
  <a
    target="_blank"
    href="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html"
    rel="noopener noreferrer"
    className="shortcut-info-element statusbar-doc-link"
  >
    <FileTextOutlined style={moreIconStyle} /> Shortcut Documentation
  </a>
);

function useShortcutItems(): ShortcutItem[] {
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const userConfiguration = useWkSelector((state) => state.userConfiguration);
  const isPlaneMode = useWkSelector((state) => getIsPlaneMode(state));
  const isShiftPressed = useKeyPress("Shift");
  const isControlOrMetaPressed = useKeyPress("ControlOrMeta");
  const isAltPressed = useKeyPress("Alt");
  const hasSkeleton = useWkSelector((state) => state.annotation.skeleton != null);
  const isTDViewportActive = useWkSelector(
    (state) => state.viewModeData.plane.activeViewport === OrthoViews.TDView,
  );

  if (!isPlaneMode) {
    let actionDescriptor: ActionDescriptor | null = null;
    if (hasSkeleton && isShiftPressed) {
      actionDescriptor = getToolControllerForAnnotationTool(
        AnnotationTool.SKELETON,
      ).getActionDescriptors(
        AnnotationTool.SKELETON,
        userConfiguration,
        isShiftPressed,
        isControlOrMetaPressed,
        isAltPressed,
        isTDViewportActive,
      );
    }

    const items: ShortcutItem[] =
      actionDescriptor != null
        ? getLeftClickItems(actionDescriptor)
        : [
            {
              key: "move",
              node: (
                <span className="shortcut-info-element">
                  <Icon
                    className="statusbar-drag-icon"
                    component={IconStatusbarMouseLeftDrag}
                    aria-label="Mouse Left Drag"
                  />
                  Move
                </span>
              ),
            },
          ];
    items.push(
      {
        key: "trace-forward",
        node: (
          <Space size="small" className="shortcut-info-element">
            <Text keyboard>Space</Text>
            Trace forward
          </Space>
        ),
      },
      {
        key: "trace-backward",
        node: (
          <Space size="small" className="shortcut-info-element">
            <Text keyboard>Ctrl + Space</Text>
            Trace backward
          </Space>
        ),
      },
      {
        key: "rotation",
        node: (
          <Space size="small" className="shortcut-info-element">
            <Text keyboard>◀ / ▶</Text>
            Rotation
          </Space>
        ),
      },
      ...getMoreShortcutsItems(),
    );
    return items;
  }

  const adaptedTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
  );
  const toolController = getToolControllerForAnnotationTool(adaptedTool);
  const actionDescriptor = toolController.getActionDescriptors(
    adaptedTool,
    userConfiguration,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
    isTDViewportActive,
  );

  return [
    ...getLeftClickItems(actionDescriptor),
    ...getRightClickItems(actionDescriptor),
    {
      key: "wheel",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon component={IconStatusbarMouseWheel} aria-label="Mouse Wheel" />
          {isAltPressed || isControlOrMetaPressed ? "Zoom in/out" : "Move along 3rd axis"}
        </Space>
      ),
    },
    {
      key: "rotate-3d",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon
            className="statusbar-drag-icon"
            component={IconStatusbarMouseRightDrag}
            aria-label="Mouse Right"
          />
          Rotate 3D View
        </Space>
      ),
    },
    getZoomShortcutItem(),
    ...getMoreShortcutsItems(),
  ];
}

// forwardRef (and spreading ...props) is required here because antd's Popover clones
// its child to inject the click handler and a positioning ref directly onto it -- a
// plain function component would silently drop both, leaving the trigger unclickable.
const MoreButtonLabel = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { label: string }
>(({ label, ...props }, ref) => (
  <span {...props} ref={ref} className="shortcut-info-element" style={{ cursor: "pointer" }}>
    <FileTextOutlined /> {label}
  </span>
));
MoreButtonLabel.displayName = "MoreButtonLabel";

// "More" implies there's something in addition to what's already visible, which is
// misleading once every hint has been hidden -- in that case, the trigger IS the only
// way to reach the hints, so it's labeled to describe its content instead.
const MORE_LABEL = "More";
const ALL_HIDDEN_LABEL = "Controls";

function MoreShortcutsButton({
  hiddenItems,
  allHidden,
}: {
  hiddenItems: ShortcutItem[];
  allHidden: boolean;
}) {
  return (
    <Popover
      trigger="click"
      placement="top"
      content={
        <div
          className="statusbar-overflow-content"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxWidth: 280,
          }}
        >
          {hiddenItems.map((item) => (
            <React.Fragment key={item.key}>{item.node}</React.Fragment>
          ))}
        </div>
      }
    >
      <MoreButtonLabel label={allHidden ? ALL_HIDDEN_LABEL : MORE_LABEL} />
    </Popover>
  );
}

function SegmentInfo() {
  const visibleSegmentationLayer = useWkSelector((state) => getVisibleSegmentationLayer(state));
  const hasVisibleSegmentation = visibleSegmentationLayer != null;
  const activeMappingInfo = useWkSelector((state) =>
    getMappingInfoOrNull(
      state.temporaryConfiguration.activeMappingByLayer,
      visibleSegmentationLayer?.name,
    ),
  );
  const hoveredSegmentId = useWkSelector((state) => state.temporaryConfiguration.hoveredSegmentId);

  if (hasVisibleSegmentation == null) {
    return null;
  }

  const idString =
    hoveredSegmentId == null
      ? "-"
      : activeMappingInfo?.mappingStatus === MappingStatusEnum.ENABLED
        ? `${hoveredSegmentId} (mapped)`
        : `${hoveredSegmentId}`;

  return <span className="info-element">Segment {idString}</span>;
}

function Infos() {
  const isSkeletonAnnotation = useWkSelector((state) => state.annotation.skeleton != null);
  const activeVolumeTracing = useWkSelector((state) => getActiveSegmentationTracing(state));

  const activeCellId = activeVolumeTracing?.activeCellId;
  const activeNodeId = useWkSelector((state) =>
    state.annotation.skeleton ? state.annotation.skeleton.activeNodeId : null,
  );
  const activeTreeId = useWkSelector((state) =>
    state.annotation.skeleton ? state.localSkeletonState.activeTreeId : null,
  );
  const dispatch = useDispatch();

  const onChangeActiveCellId = useCallback(
    (id: bigint) => dispatch(setActiveCellAction(id)),
    [dispatch],
  );
  const onChangeActiveNodeId = useCallback(
    (id: number) => {
      dispatch(setActiveNodeAction(id));
    },
    [dispatch],
  );
  const onChangeActiveTreeId = useCallback(
    (id: number) => dispatch(setActiveTreeAction(id)),
    [dispatch],
  );

  const validSegmentIdRange = useWkSelector((state) => {
    if (!activeVolumeTracing) {
      return null;
    }
    const segmentationLayer = getSegmentationLayerForTracing(state, activeVolumeTracing);
    const elementClass = segmentationLayer.elementClass;
    return getSegmentIdRangeForElementClass(elementClass);
  });

  return (
    <React.Fragment>
      <SegmentAndMousePosition />
      <span className="info-element">
        <DownloadSpeedometer />
      </span>
      {activeVolumeTracing != null && validSegmentIdRange != null ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeCellId ?? null}
            label="Active Segment"
            min={validSegmentIdRange[0]}
            max={validSegmentIdRange[1]}
            detailedLabel="Change Active Segment ID"
            onChange={onChangeActiveCellId}
          />
        </span>
      ) : null}
      {isSkeletonAnnotation ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeNodeId}
            label="Active Node"
            detailedLabel="Change Active Node ID"
            onChange={onChangeActiveNodeId}
          />
        </span>
      ) : null}
      {isSkeletonAnnotation ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeTreeId}
            label="Active Tree"
            detailedLabel="Change Active Tree ID"
            onChange={onChangeActiveTreeId}
          />
        </span>
      ) : null}
      <MagnificationInfo />
    </React.Fragment>
  );
}

function DownloadSpeedometer() {
  const [currentBucketDownloadSpeed, setCurrentBucketDownloadSpeed] = useState<number>(0);
  const [totalDownloadedByteCount, setTotalDownloadedByteCount] = useState<number>(0);
  useInterval(() => {
    const { avgDownloadSpeedInBytesPerS, accumulatedDownloadedBytes } =
      getGlobalDataConnectionInfo().getStatistics();
    setCurrentBucketDownloadSpeed(avgDownloadSpeedInBytesPerS);
    setTotalDownloadedByteCount(accumulatedDownloadedBytes);
  }, 1500);

  return (
    <FastTooltip
      title={`Downloaded ${formatCountToDataAmountUnit(
        totalDownloadedByteCount,
      )} of Image Data (after decompression)`}
    >
      <DownloadOutlined className="icon-margin-right" />
      {formatCountToDataAmountUnit(currentBucketDownloadSpeed)}/s
    </FastTooltip>
  );
}

function MagnificationInfo() {
  const { representativeMag, isActiveMagGlobal } = useWkSelector(getActiveMagInfo);

  const renderMagTooltipContent = useCallback(() => {
    const state = Store.getState();
    const { activeMagOfEnabledLayers } = getActiveMagInfo(state);
    const dataset = state.dataset;
    const annotation = state.annotation;

    return (
      <div style={{ width: 200 }}>
        Rendered magnification per layer:
        <ul>
          {Object.entries(activeMagOfEnabledLayers).map(([layerName, mag]) => {
            const readableName = getReadableNameForLayerName(dataset, annotation, layerName);

            return (
              <li key={layerName}>
                {readableName}: {mag ? mag.join("-") : "none"}
              </li>
            );
          })}
        </ul>
        {messages["dataset.mag_explanation"]}
      </div>
    );
  }, []);

  if (representativeMag == null) {
    return null;
  }

  return (
    <span className="info-element">
      <Icon component={IconStatusbarDownsampling} aria-label="Magnification" />{" "}
      <FastTooltip dynamicRenderer={renderMagTooltipContent} placement="top">
        {representativeMag.join("-")}
        {isActiveMagGlobal ? "" : "*"}{" "}
      </FastTooltip>
    </span>
  );
}

function SegmentAndMousePosition() {
  // This component depends on the mouse position which is a fast-changing property.
  // For the sake of performance, it is isolated as a single component.
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const isPlaneMode = useWkSelector((state) => getIsPlaneMode(state));
  const globalMousePositionRounded = useWkSelector(getGlobalMousePosition);

  return (
    <>
      {isPlaneMode ? <SegmentInfo /> : null}
      {isPlaneMode ? (
        <span className="info-element">
          Pos [
          {globalMousePositionRounded
            ? getPosString(globalMousePositionRounded, additionalCoordinates)
            : "-,-,-"}
          ]
        </span>
      ) : null}
    </>
  );
}

function Statusbar() {
  // The statusbar can run out of horizontal space (e.g. on 13" laptops). Since the
  // shortcut hints are the least essential elements (as opposed to e.g. the "Active
  // Segment" input, which is not just informational), as many of them as fit are shown
  // individually, with the rest tucked behind a "More" popover, so that all other
  // elements remain reachable.
  const items = useShortcutItems();
  // Read via a ref inside recompute() (rather than closing over `items`) so the
  // ResizeObserver doesn't need to be torn down and reconnected on every render --
  // `items` is a new array/JSX identity on every render (e.g. on every key press).
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const containerRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const infosRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);
  const measureRowRef = useRef<HTMLSpanElement>(null);
  const measureMoreRef = useRef<HTMLSpanElement>(null);
  const measureAllHiddenRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Map<string, HTMLSpanElement>>(new Map());

  const [visibleCount, setVisibleCount] = useState(items.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const left = leftRef.current;
    const infos = infosRef.current;
    const right = rightRef.current;
    const measureRow = measureRowRef.current;
    const measureMore = measureMoreRef.current;
    const measureAllHidden = measureAllHiddenRef.current;
    if (
      container == null ||
      left == null ||
      infos == null ||
      right == null ||
      measureRow == null ||
      measureMore == null ||
      measureAllHidden == null
    ) {
      return;
    }

    const recompute = () => {
      // Each group's own (margin-excluding) offsetWidth is used here, rather than e.g.
      // deriving it from container.scrollWidth minus the shortcuts width. That's because
      // Infos is right-aligned via `margin-left: auto`, which always expands to fill any
      // free space -- so container.scrollWidth would equal clientWidth whenever there's
      // no overflow, regardless of how many shortcut items are currently shown, making it
      // impossible to detect that there's enough room to show more of them.
      const fixedWidth = left.offsetWidth + infos.offsetWidth + right.offsetWidth;
      // Reserved so that the shortcuts area never butts directly up against Infos --
      // without this, unlucky container widths could make e.g. "More" and "Segment 0"
      // touch, since Infos is only pushed away by whatever space is left over.
      const availableForShortcuts = container.clientWidth - fixedWidth - MIN_GAP_BEFORE_INFOS;
      // The trigger's label (and thus its width) depends on whether it ends up being the
      // only thing shown, which is exactly what this calculation determines -- so the
      // wider of the two possible labels is reserved to be safe regardless of outcome.
      const moreButtonWidth = Math.max(measureMore.offsetWidth, measureAllHidden.offsetWidth);

      const currentItems = itemsRef.current;
      const itemWidths = currentItems.map(
        (item) => itemRefs.current.get(item.key)?.offsetWidth ?? 0,
      );
      const totalItemsWidth = itemWidths.reduce((sum, width) => sum + width, 0);

      let count: number;
      if (totalItemsWidth <= availableForShortcuts) {
        // Everything fits -- no "More" button needed.
        count = currentItems.length;
      } else {
        // A "More" button will be shown, so its width is reserved up front (rather than
        // only between individual items) -- otherwise, if zero items end up fitting,
        // nothing would have verified that the "More" button alone still leaves the
        // minimum gap before Infos.
        const budget = availableForShortcuts - moreButtonWidth;
        let usedWidth = 0;
        count = 0;
        for (let i = 0; i < itemWidths.length; i++) {
          if (usedWidth + itemWidths[i] > budget) {
            break;
          }
          usedWidth += itemWidths[i];
          count++;
        }
      }
      setVisibleCount(count);
    };
    recompute();

    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(container);
    resizeObserver.observe(infos);
    resizeObserver.observe(measureRow);
    return () => resizeObserver.disconnect();
  }, []);

  const hiddenItems = items.slice(visibleCount);

  return (
    <span className="statusbar" ref={containerRef}>
      <span ref={leftRef} style={{ display: "inline-flex" }}>
        <BorderToggleButton side="left" inFooter />
      </span>
      {items.slice(0, visibleCount).map((item) => (
        <React.Fragment key={item.key}>{item.node}</React.Fragment>
      ))}
      {hiddenItems.length > 0 ? (
        <MoreShortcutsButton hiddenItems={hiddenItems} allHidden={visibleCount === 0} />
      ) : null}
      <span ref={infosRef} style={{ display: "inline-flex", marginLeft: "auto" }}>
        <Infos />
      </span>
      <span ref={rightRef} style={{ display: "inline-flex" }}>
        <BorderToggleButton side="right" inFooter />
      </span>
      <span ref={measureRowRef} className="statusbar-measurer" aria-hidden="true">
        {items.map((item) => (
          <span
            key={item.key}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(item.key, el);
              } else {
                itemRefs.current.delete(item.key);
              }
            }}
            style={{ display: "inline-flex" }}
          >
            {item.node}
          </span>
        ))}
        <span ref={measureMoreRef} style={{ display: "inline-flex" }}>
          <MoreButtonLabel label={MORE_LABEL} />
        </span>
        <span ref={measureAllHiddenRef} style={{ display: "inline-flex" }}>
          <MoreButtonLabel label={ALL_HIDDEN_LABEL} />
        </span>
      </span>
    </span>
  );
}

export default Statusbar;
