import { Select, Space, Typography } from "antd";
import { AsyncButton } from "components/async_clickables";
import { pluralize } from "libs/utils";
import type { APIDataset } from "types/api_types";

type Props = {
  dataset: APIDataset;
  fixedLayerName: string | null;
  onChange: (fixedLayerName: string | null) => void;
  // The number of existing layer registration annotations for the selected fixed layer.
  existingLayerRegistrationCount: number;
  onCreate: (fixedLayerName: string) => Promise<void>;
};

// Selects the fixed layer of a new layer registration annotation. The selection also filters the
// list of existing layer registration annotations, so that the user sees them before creating a new
// one.
export function LayerRegistrationFixedLayerPicker({
  dataset,
  fixedLayerName,
  onChange,
  existingLayerRegistrationCount,
  onCreate,
}: Props) {
  const hasExistingLayerRegistrations =
    fixedLayerName != null && existingLayerRegistrationCount > 0;

  return (
    <Space orientation="vertical" style={{ width: "100%", maxWidth: 480 }}>
      <Typography.Text>
        Pick the fixed (reference) layer, which stays put. All other layers can then be registered
        to it, one after the other.
      </Typography.Text>
      <Select
        placeholder="Fixed layer (does not move)"
        style={{ width: "100%" }}
        allowClear
        value={fixedLayerName ?? undefined}
        onChange={(value) => onChange(value ?? null)}
        options={dataset.dataSource.dataLayers.map(({ name }) => ({ value: name, label: name }))}
      />
      {hasExistingLayerRegistrations ? (
        <Typography.Text type="secondary">
          {existingLayerRegistrationCount}{" "}
          {pluralize("layer registration", existingLayerRegistrationCount)} to this layer already{" "}
          {existingLayerRegistrationCount === 1 ? "exists" : "exist"} below. Consider continuing{" "}
          {existingLayerRegistrationCount === 1 ? "it" : "one of them"} instead of starting a new
          one.
        </Typography.Text>
      ) : null}
      <AsyncButton
        type={hasExistingLayerRegistrations ? "default" : "primary"}
        disabled={fixedLayerName == null}
        onClick={async () => {
          if (fixedLayerName != null) {
            await onCreate(fixedLayerName);
          }
        }}
      >
        {fixedLayerName != null
          ? `Create new layer registration to ${fixedLayerName}`
          : "Create new layer registration"}
      </AsyncButton>
    </Space>
  );
}
