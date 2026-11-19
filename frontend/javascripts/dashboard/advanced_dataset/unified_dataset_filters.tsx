// Unified datasets prototype (features.unifiedDatasets): filter controls of the dataset list and
// the header of the list of a dataset's copies.
import { CloseOutlined, CopyOutlined } from "@ant-design/icons";
import { Button, Flex, Segmented, Space, Switch, Typography } from "antd";
import { useDatasetQuery } from "dashboard/dataset/queries";
import type {
  AnnotationLayerFilter,
  UnifiedDatasetListFilters,
} from "dashboard/dataset/unified_dataset_list_filters";

const ANNOTATION_LAYER_FILTER_OPTIONS: Array<{ value: AnnotationLayerFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "withoutAnnotationLayers", label: "Without annotation layers" },
  { value: "withAnnotationLayers", label: "With annotation layers" },
];

export function UnifiedDatasetFilterControls({
  filters,
  onChange,
  showCopyToggles,
}: {
  filters: UnifiedDatasetListFilters;
  onChange: (update: Partial<UnifiedDatasetListFilters>) => void;
  // The copy toggles don't apply to the list of a dataset's copies.
  showCopyToggles: boolean;
}) {
  return (
    <Space size="middle" wrap>
      <Space size={4}>
        <Typography.Text type="secondary">Show:</Typography.Text>
        <Segmented<AnnotationLayerFilter>
          size="small"
          options={ANNOTATION_LAYER_FILTER_OPTIONS}
          value={filters.annotationLayerFilter}
          onChange={(annotationLayerFilter) => onChange({ annotationLayerFilter })}
        />
      </Space>
      {showCopyToggles ? (
        <>
          <LabeledSwitch
            label="Group copies"
            checked={filters.groupCopies}
            onChange={(groupCopies) => onChange({ groupCopies })}
          />
          <LabeledSwitch
            label="Show copies by others"
            checked={filters.showCopiesByOthers}
            onChange={(showCopiesByOthers) => onChange({ showCopiesByOthers })}
          />
        </>
      ) : null}
    </Space>
  );
}

function LabeledSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
      <Space size={4}>
        <Switch size="small" checked={checked} onChange={onChange} />
        {label}
      </Space>
    </label>
  );
}

export function CopiesOfDatasetHeader({
  datasetId,
  onDismiss,
}: {
  datasetId: string;
  onDismiss: () => void;
}) {
  const { data: dataset } = useDatasetQuery(datasetId);
  return (
    <Flex align="center" gap="small" style={{ marginBottom: 12 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        <CopyOutlined className="icon-margin-right" />
        Copies of {dataset?.name ?? "…"}
      </Typography.Title>
      <Button size="small" icon={<CloseOutlined />} onClick={onDismiss}>
        Show all datasets
      </Button>
    </Flex>
  );
}
