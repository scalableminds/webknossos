import { Select, Space, Typography } from "antd";
import { AsyncButton } from "components/async_clickables";
import { pluralize } from "libs/utils";
import type { APIDataset } from "types/api_types";

type Props = {
  dataset: APIDataset;
  fixedLayerName: string | null;
  movingLayerName: string | null;
  onChange: (fixedLayerName: string | null, movingLayerName: string | null) => void;
  // The number of existing alignment annotations for the selected layer pair.
  existingAlignmentCount: number;
  onCreate: (fixedLayerName: string, movingLayerName: string) => Promise<void>;
};

// Selects the layer pair of a new alignment annotation. The selection also filters the list
// of existing alignment annotations, so that the user sees them before creating a new one.
export function LayerPairPicker({
  dataset,
  fixedLayerName,
  movingLayerName,
  onChange,
  existingAlignmentCount,
  onCreate,
}: Props) {
  const layerNames = dataset.dataSource.dataLayers.map((layer) => layer.name);
  const isPairSelected = fixedLayerName != null && movingLayerName != null;
  const hasExistingAlignments = isPairSelected && existingAlignmentCount > 0;

  const getOptions = (excludedLayerName: string | null) =>
    layerNames
      .filter((name) => name !== excludedLayerName)
      .map((name) => ({ value: name, label: name }));

  return (
    <Space orientation="vertical" style={{ width: "100%", maxWidth: 480 }}>
      <Typography.Text>
        Pick the fixed (reference) layer, which stays put, and the moving layer, which will be
        warped onto it.
      </Typography.Text>
      <Select
        placeholder="Fixed layer (does not move)"
        style={{ width: "100%" }}
        allowClear
        value={fixedLayerName ?? undefined}
        onChange={(value) => onChange(value ?? null, movingLayerName)}
        options={getOptions(movingLayerName)}
      />
      <Select
        placeholder="Moving layer (gets warped)"
        style={{ width: "100%" }}
        allowClear
        value={movingLayerName ?? undefined}
        onChange={(value) => onChange(fixedLayerName, value ?? null)}
        options={getOptions(fixedLayerName)}
      />
      {hasExistingAlignments ? (
        <Typography.Text type="secondary">
          {existingAlignmentCount} {pluralize("alignment", existingAlignmentCount)} for this layer
          pair already {existingAlignmentCount === 1 ? "exists" : "exist"} below. Consider
          continuing {existingAlignmentCount === 1 ? "it" : "one of them"} instead of starting a new
          one.
        </Typography.Text>
      ) : null}
      <AsyncButton
        type={hasExistingAlignments ? "default" : "primary"}
        disabled={!isPairSelected}
        onClick={async () => {
          if (fixedLayerName != null && movingLayerName != null) {
            await onCreate(fixedLayerName, movingLayerName);
          }
        }}
      >
        {isPairSelected
          ? `Create new alignment for ${movingLayerName} → ${fixedLayerName}`
          : "Create new alignment"}
      </AsyncButton>
    </Space>
  );
}
