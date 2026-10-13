import { Select, Space, Typography } from "antd";
import { AsyncButton } from "components/async_clickables";
import { pluralize } from "libs/utils";
import type { APIDataset } from "types/api_types";

type Props = {
  dataset: APIDataset;
  fixedLayerName: string | null;
  onChange: (fixedLayerName: string | null) => void;
  // The number of existing alignment annotations for the selected fixed layer.
  existingAlignmentCount: number;
  onCreate: (fixedLayerName: string) => Promise<void>;
};

// Selects the fixed layer of a new alignment annotation. The selection also filters the list of
// existing alignment annotations, so that the user sees them before creating a new one.
export function FixedLayerPicker({
  dataset,
  fixedLayerName,
  onChange,
  existingAlignmentCount,
  onCreate,
}: Props) {
  const hasExistingAlignments = fixedLayerName != null && existingAlignmentCount > 0;

  return (
    <Space orientation="vertical" style={{ width: "100%", maxWidth: 480 }}>
      <Typography.Text>
        Pick the fixed (reference) layer, which stays put. All other layers can then be aligned to
        it, one after the other.
      </Typography.Text>
      <Select
        placeholder="Fixed layer (does not move)"
        style={{ width: "100%" }}
        allowClear
        value={fixedLayerName ?? undefined}
        onChange={(value) => onChange(value ?? null)}
        options={dataset.dataSource.dataLayers.map(({ name }) => ({ value: name, label: name }))}
      />
      {hasExistingAlignments ? (
        <Typography.Text type="secondary">
          {existingAlignmentCount} {pluralize("alignment", existingAlignmentCount)} to this layer
          already {existingAlignmentCount === 1 ? "exists" : "exist"} below. Consider continuing{" "}
          {existingAlignmentCount === 1 ? "it" : "one of them"} instead of starting a new one.
        </Typography.Text>
      ) : null}
      <AsyncButton
        type={hasExistingAlignments ? "default" : "primary"}
        disabled={fixedLayerName == null}
        onClick={async () => {
          if (fixedLayerName != null) {
            await onCreate(fixedLayerName);
          }
        }}
      >
        {fixedLayerName != null
          ? `Create new alignment to ${fixedLayerName}`
          : "Create new alignment"}
      </AsyncButton>
    </Space>
  );
}
