import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Empty,
  Flex,
  Select,
  Space,
  Splitter,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import type { APISegmentationLayer } from "types/api_types";
import { LongUnitToShortUnitMap } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import {
  getAdditionalCoordinatesAsString,
  hasAdditionalCoordinates,
} from "viewer/model/accessors/flycam_accessor";
import {
  getActiveSegmentationTracing,
  getReadableNameByVolumeTracingId,
  getVisibleSegments,
} from "viewer/model/accessors/volumetracing_accessor";
import { ensureSegmentIndexIsLoadedAction } from "viewer/model/actions/dataset_actions";
import { setSegmentStatisticsScopeAction } from "viewer/model/actions/ui_actions";
import type { Segment, SegmentGroup, SegmentStatisticsScope } from "viewer/store";
import { findGroup, MISSING_GROUP_ID } from "../shared/tree_hierarchy_view_helpers";
import { useSegmentStatisticsRows } from "./hooks/use_segment_statistics_rows";
import { exportStatisticsToCSV } from "./segment_statistics_helpers";
import { SegmentStatisticsRail } from "./segment_statistics_rail";
import { SegmentStatisticsTable } from "./segment_statistics_table";
import { buildGroupedTableRows, toSegmentTableRows } from "./segment_statistics_tree";
import {
  filterRows,
  type GroupBy,
  getColumnSpecs,
  resolveUnit,
  useStatisticsView,
} from "./segment_statistics_view";
import { getSegmentsOfGroupRecursively } from "./segments_view_helper";

const MAX_SEGMENT_COUNT_FOR_AUTOMATIC_COMPUTATION = 50;
const RAIL_WIDTH = 272;

function getScopeLabel(scope: SegmentStatisticsScope, segmentGroups: SegmentGroup[]): string {
  if (scope.kind === "group") {
    const groupName = findGroup(segmentGroups, scope.groupId)?.name;
    return groupName != null ? `Group "${groupName}"` : `Group ${scope.groupId}`;
  }
  return scope.segmentIds.length === 1
    ? `Segment ${scope.segmentIds[0]}`
    : `${scope.segmentIds.length} selected segments`;
}

// Appended to the exported filename to tell exports of the same layer apart.
function getCsvFilenameSuffix(scope: SegmentStatisticsScope | null): string | null {
  if (scope == null) {
    return null;
  }
  if (scope.kind === "group") {
    return scope.groupId === MISSING_GROUP_ID ? null : `group-${scope.groupId}`;
  }
  return scope.segmentIds.length === 1
    ? `segment-${scope.segmentIds[0]}`
    : `${scope.segmentIds.length}-selected-segments`;
}

function useSegmentsInScope(scope: SegmentStatisticsScope | null): Segment[] {
  const segments = useWkSelector((state) => getVisibleSegments(state).segments);
  const segmentGroups = useWkSelector((state) => getVisibleSegments(state).segmentGroups);

  return useMemo(() => {
    if (segments == null) {
      return [];
    }
    if (scope?.kind === "segments") {
      return scope.segmentIds
        .map((segmentId) => segments.getNullable(segmentId))
        .filter((segment) => segment != null);
    }
    return getSegmentsOfGroupRecursively(
      scope?.groupId ?? MISSING_GROUP_ID,
      segments,
      segmentGroups,
    );
  }, [segments, segmentGroups, scope]);
}

function SegmentStatisticsTabContent({ layer }: { layer: APISegmentationLayer }) {
  const dispatch = useDispatch();
  const datasetName = useWkSelector((state) => state.dataset.name);
  // The technical name of a volume annotation layer is its tracing id.
  const layerName = useWkSelector((state) =>
    layer.tracingId != null
      ? getReadableNameByVolumeTracingId(state.annotation, layer.tracingId)
      : layer.name,
  );
  const tracingId = useWkSelector((state) => getActiveSegmentationTracing(state)?.tracingId);
  const segmentGroups = useWkSelector((state) => getVisibleSegments(state).segmentGroups);
  // A scope that was chosen in another layer does not apply to this one.
  const scope = useWkSelector((state) => {
    const { segmentStatisticsScope } = state.uiInformation;
    return segmentStatisticsScope?.layerName === layer.name ? segmentStatisticsScope : null;
  });
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const segments = useSegmentsInScope(scope);

  useEffect(() => {
    dispatch(ensureSegmentIndexIsLoadedAction(layer.name));
  }, [dispatch, layer.name]);

  // Computing the statistics of many segments is expensive for the backend, so for large scopes
  // it only happens on request. The request is tied to the scope it was made for.
  const [confirmedScope, setConfirmedScope] = useState<{
    scope: SegmentStatisticsScope | null;
  } | null>(null);
  const isComputationConfirmed =
    segments.length <= MAX_SEGMENT_COUNT_FOR_AUTOMATIC_COMPUTATION ||
    confirmedScope?.scope === scope;

  // The statistics are not recomputed on every change of the annotation, as this is expensive.
  // Instead, the user refreshes them when needed.
  const [refreshToken, setRefreshToken] = useState<number | null>(null);

  const { rows, statisticSpecs, isAnyStatisticLoading, fileInfo, areSegmentStatisticsAvailable } =
    useSegmentStatisticsRows({
      layer,
      segments,
      segmentGroups,
      enabled: isComputationConfirmed,
      refreshToken,
    });

  const view = useStatisticsView();
  const datasetUnit = useWkSelector(
    (state) => LongUnitToShortUnitMap[state.dataset.dataSource.scale.unit],
  );
  const columnSpecs = useMemo(() => getColumnSpecs(statisticSpecs), [statisticSpecs]);
  const visibleColumnSpecs = useMemo(
    () => columnSpecs.filter((spec) => !view.hiddenColumnKeys.has(spec.key)),
    [columnSpecs, view.hiddenColumnKeys],
  );
  const units = useMemo(
    () =>
      Object.fromEntries(
        columnSpecs.map((spec) => [
          spec.key,
          resolveUnit(spec.value, rows, datasetUnit, view.chosenUnits[spec.key]),
        ]),
      ),
    [columnSpecs, rows, datasetUnit, view.chosenUnits],
  );
  const filteredRows = useMemo(
    () => filterRows(rows, columnSpecs, view.ranges),
    [rows, columnSpecs, view.ranges],
  );
  const tableRows = useMemo(
    () =>
      view.groupBy === "group"
        ? buildGroupedTableRows(filteredRows, segmentGroups, statisticSpecs)
        : toSegmentTableRows(filteredRows),
    [view.groupBy, filteredRows, segmentGroups, statisticSpecs],
  );
  const filteredTitles = columnSpecs
    .filter((spec) => view.ranges[spec.key] != null)
    .map((spec) => spec.title.toLowerCase());
  // Hidden columns are left out of the export. Specs without a column (e.g. ids) are always kept.
  const exportedSpecs = statisticSpecs.filter((spec) => !view.hiddenColumnKeys.has(spec.key));

  if (!areSegmentStatisticsAvailable && !isAnyStatisticLoading) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Segment statistics are not available for this layer, because it has neither a segment index nor a segment statistics file."
      />
    );
  }

  return (
    <Flex vertical gap="small" style={{ height: "100%", minHeight: 0 }}>
      <Flex align="center" gap="small" wrap>
        <Typography.Text strong>{layerName}</Typography.Text>
        <Typography.Text type="secondary">
          {filteredTitles.length > 0
            ? `${filteredRows.length} of ${segments.length} ${pluralize("segment", segments.length)} · filtered by ${filteredTitles.join(", ")}`
            : `${segments.length} ${pluralize("segment", segments.length)}`}
        </Typography.Text>
        {scope != null ? (
          <Tag closable onClose={() => dispatch(setSegmentStatisticsScopeAction(null))}>
            {getScopeLabel(scope, segmentGroups)}
          </Tag>
        ) : null}
        <div style={{ flex: 1 }} />
        {segmentGroups.length > 0 ? (
          <Space size="small">
            <Typography.Text type="secondary">Group by</Typography.Text>
            <Select<GroupBy>
              value={view.groupBy}
              onChange={view.setGroupBy}
              style={{ width: 160 }}
              options={[
                { value: "group", label: "Segment groups" },
                { value: "none", label: "No grouping" },
              ]}
            />
          </Space>
        ) : null}
        <Tooltip title="Recompute the statistics, e.g. after editing segments">
          <Button
            icon={<ReloadOutlined />}
            aria-label="Refresh statistics"
            disabled={!isComputationConfirmed || isAnyStatisticLoading}
            onClick={() => setRefreshToken(Date.now())}
          />
        </Tooltip>
        <Button
          icon={<DownloadOutlined />}
          disabled={!isComputationConfirmed || isAnyStatisticLoading || filteredRows.length === 0}
          onClick={() =>
            exportStatisticsToCSV(
              filteredRows,
              exportedSpecs,
              tracingId || datasetName,
              getCsvFilenameSuffix(scope),
            )
          }
        >
          {`Export ${filteredRows.length} ${pluralize("row", filteredRows.length)}`}
        </Button>
      </Flex>
      {hasAdditionalCoordinates(additionalCoordinates) ? (
        <Alert
          title={`These statistics only refer to the current additional ${pluralize(
            "coordinate",
            additionalCoordinates?.length || 0,
          )} ${getAdditionalCoordinatesAsString(additionalCoordinates, ", ")}.`}
          type="info"
          showIcon
        />
      ) : null}
      {!isComputationConfirmed ? (
        <Alert
          title={`Computing the statistics of ${segments.length} segments can take a while.`}
          type="info"
          showIcon
          action={
            <Button size="small" type="primary" onClick={() => setConfirmedScope({ scope })}>
              Compute statistics
            </Button>
          }
        />
      ) : null}
      {fileInfo != null ? (
        <Alert
          title={`Statistics are read from a precomputed segment statistics file, which was computed for mag ${fileInfo.mag.join(
            "-",
          )}.`}
          type="info"
          showIcon
        />
      ) : null}
      <Splitter style={{ flex: 1, minHeight: 0 }}>
        <Splitter.Panel defaultSize={RAIL_WIDTH} min={220} max={420} collapsible>
          <SegmentStatisticsRail columnSpecs={columnSpecs} units={units} rows={rows} view={view} />
        </Splitter.Panel>
        <Splitter.Panel>
          <Flex vertical style={{ height: "100%", minHeight: 0, paddingInlineStart: 8 }}>
            <SegmentStatisticsTable
              rows={rows}
              tableRows={tableRows}
              columnSpecs={visibleColumnSpecs}
              units={units}
              sort={view.sort}
              onSortChange={view.setSort}
              layerName={layer.name}
            />
          </Flex>
        </Splitter.Panel>
      </Splitter>
    </Flex>
  );
}

export default function SegmentStatisticsTab() {
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);

  return (
    <div className="padded-tab-content" style={{ height: "100%" }}>
      {visibleSegmentationLayer == null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No segmentation layer visible." />
      ) : (
        // Keyed by the layer, so that no state (e.g. the confirmation to compute the statistics
        // of many segments) carries over to another layer.
        <SegmentStatisticsTabContent
          key={visibleSegmentationLayer.name}
          layer={visibleSegmentationLayer}
        />
      )}
    </div>
  );
}
