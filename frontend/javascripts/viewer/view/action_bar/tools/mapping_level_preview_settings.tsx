import { Button, Space } from "antd";
import { Slider } from "components/slider";
import { useWkSelector } from "libs/react_hooks";
import { clamp } from "libs/utils";
import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import {
  getActiveSegmentationTracing,
  getActiveSegmentationTracingLayer,
  getEditableMappingForVolumeTracingId,
} from "viewer/model/accessors/volumetracing_accessor";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import {
  clearMappingLevelPreviewAction,
  commitMappingLevelPreviewAction,
  setMappingLevelPreviewTargetAction,
} from "viewer/model/actions/proofread_actions";
import useMappingLevelPreviewSkeleton from "./use_mapping_level_preview_skeleton";

// Best-effort numeric ordering of agglomerate-file names by their trailing digits (e.g. "agglomerate_view_60" -> 60).
// The available levels can be irregularly spaced (e.g. 5, 10, 45, 50, 85, 90, 100), so the slider is index-based.
function parseLevelValue(name: string): number | null {
  const match = name.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function levelLabel(name: string): string {
  const value = parseLevelValue(name);
  return value != null ? String(value) : name;
}

// Panel content of the per-agglomerate mapping-level preview subtool (see SPIKE-per-agglomerate-mapping-level.md).
// `active` should reflect whether the subtool popover is open; it drives the ephemeral preview-skeleton lifecycle.
// `onClose` closes the surrounding popover (the panel never closes itself implicitly).
export function MappingLevelPreviewPanel({
  active,
  onClose,
}: {
  active: boolean;
  onClose: () => void;
}) {
  const dispatch = useDispatch();
  const segmentationLayer = useWkSelector((state) => getActiveSegmentationTracingLayer(state));
  const layerName = segmentationLayer?.name ?? null;

  const volumeTracing = useWkSelector((state) => getActiveSegmentationTracing(state));
  const activeCellId = volumeTracing?.activeCellId;
  const hasSelectedSegment = activeCellId != null && activeCellId !== 0;

  const baseMappingName = useWkSelector(
    (state) =>
      getEditableMappingForVolumeTracingId(state, volumeTracing?.tracingId)?.baseMappingName,
  );

  const preview = useWkSelector((state) =>
    layerName != null ? state.localSegmentationStateByLayer[layerName]?.mappingLevelPreview : null,
  );

  // Manage the ephemeral 3D preview skeleton for as long as the subtool is open.
  useMappingLevelPreviewSkeleton(active ? layerName : null);

  useEffect(() => {
    if (active && layerName != null) {
      dispatch(ensureLayerMappingsAreLoadedAction(layerName));
    }
  }, [active, layerName, dispatch]);

  // Only HDF5 agglomerate mappings are relevant here (JSON mappings live in `layer.mappings`).
  const sortedLevels = useMemo(() => {
    const levels = segmentationLayer?.agglomerates ?? [];
    return [...levels].sort((a, b) => {
      const va = parseLevelValue(a);
      const vb = parseLevelValue(b);
      if (va != null && vb != null) return va - vb;
      return a.localeCompare(b);
    });
  }, [segmentationLayer?.agglomerates]);

  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);

  // Default the selection to the currently locked base level (falls back to the middle of the range).
  useEffect(() => {
    if (selectedLevel != null || sortedLevels.length === 0) return;
    const defaultLevel =
      baseMappingName != null && sortedLevels.includes(baseMappingName)
        ? baseMappingName
        : sortedLevels[Math.floor(sortedLevels.length / 2)];
    setSelectedLevel(defaultLevel);
  }, [selectedLevel, sortedLevels, baseMappingName]);

  // Keep the local selection in sync with the redux preview target (e.g. after a commit clears it).
  useEffect(() => {
    if (preview?.targetMappingName != null) {
      setSelectedLevel(preview.targetMappingName);
    }
  }, [preview?.targetMappingName]);

  const applyLevel = (level: string) => {
    setSelectedLevel(level);
    dispatch(setMappingLevelPreviewTargetAction(level));
  };

  const selectedIndex = clamp(
    0,
    sortedLevels.findIndex((level) => level === selectedLevel),
    Math.max(0, sortedLevels.length - 1),
  );

  const controlsDisabled = !hasSelectedSegment || sortedLevels.length === 0;

  const marks = useMemo(() => {
    const result: Record<number, string> = {};
    if (sortedLevels.length > 0) {
      result[0] = levelLabel(sortedLevels[0]);
      result[sortedLevels.length - 1] = levelLabel(sortedLevels[sortedLevels.length - 1]);
    }
    return result;
  }, [sortedLevels]);

  return (
    <Space direction="vertical" style={{ width: 340 }} size="small">
      <div style={{ fontWeight: 500 }}>Preview agglomerate at mapping level</div>
      {!hasSelectedSegment ? (
        <div style={{ color: "var(--ant-color-text-secondary)" }}>
          Select a segment with the proofreading tool first, then choose a mapping level to preview.
        </div>
      ) : null}
      <div>
        Level: <b>{selectedLevel != null ? levelLabel(selectedLevel) : "–"}</b>
      </div>
      <Slider
        min={0}
        max={Math.max(0, sortedLevels.length - 1)}
        step={1}
        value={selectedIndex}
        disabled={controlsDisabled}
        marks={marks}
        tooltip={{
          formatter: () =>
            sortedLevels[selectedIndex] ? levelLabel(sortedLevels[selectedIndex]) : "",
        }}
        onChange={(index: number) => {
          const level = sortedLevels[index];
          if (level != null) applyLevel(level);
        }}
        onWheelDisabled
      />
      <div style={{ minHeight: 20, color: "var(--ant-color-text-secondary)" }}>
        {preview?.status === "LOADING" ? "Loading preview…" : null}
        {preview?.status === "READY" ? "Previewing (skeleton shown in the 3D viewport)." : null}
        {preview?.status === "ERROR" ? "Could not load preview." : null}
      </div>
      <Space>
        <Button
          type="primary"
          disabled={preview == null || preview.status !== "READY"}
          onClick={() => dispatch(commitMappingLevelPreviewAction())}
        >
          Apply level
        </Button>
        <Button onClick={() => dispatch(clearMappingLevelPreviewAction())}>Cancel preview</Button>
        <Button
          onClick={() => {
            dispatch(clearMappingLevelPreviewAction());
            onClose();
          }}
        >
          Close
        </Button>
      </Space>
    </Space>
  );
}
