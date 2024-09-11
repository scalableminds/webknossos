import { Form, Select } from "antd";
import { getReadableNameOfVolumeLayer } from "oxalis/model/accessors/volumetracing_accessor";
import type { HybridTracing } from "oxalis/store";
import type React from "react";
import type { APIAnnotation, APIDataLayer } from "types/api_flow_types";

type LayerSelectionProps<L extends { name: string }> = {
  name: string | Array<string | number>;
  chooseSegmentationLayer: boolean;
  layers: L[];
  getReadableNameForLayer: (layer: L) => string;
  fixedLayerName?: string;
  label?: string;
};

export function LayerSelection<L extends { name: string }>({
  layers,
  getReadableNameForLayer,
  fixedLayerName,
  layerType,
  onChange,
  style,
  value,
}: {
  layers: L[];
  getReadableNameForLayer: (layer: L) => string;
  fixedLayerName?: string;
  layerType?: string;
  style?: React.CSSProperties;
  // onChange and value should not be renamed, because these are the
  // default property names for controlled antd FormItems.
  onChange?: (a: string) => void;
  value?: string | null;
}): JSX.Element {
  const onSelect = onChange ? (layerName: string) => onChange(layerName) : undefined;
  const maybeLayerType = layerType || "";
  const maybeSpace = layerType != null ? " " : "";
  return (
    <Select
      showSearch
      placeholder={`Select a ${maybeLayerType}${maybeSpace}layer`}
      optionFilterProp="children"
      filterOption={(input, option) =>
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
      }
      disabled={fixedLayerName != null}
      onSelect={onSelect}
      style={style}
      value={value}
    >
      {layers.map((layer) => {
        const readableName = getReadableNameForLayer(layer);
        return (
          <Select.Option key={layer.name} value={layer.name}>
            {readableName}
          </Select.Option>
        );
      })}
    </Select>
  );
}

export function LayerSelectionFormItem<L extends { name: string }>({
  name,
  chooseSegmentationLayer,
  layers,
  getReadableNameForLayer,
  fixedLayerName,
  label,
}: LayerSelectionProps<L>): JSX.Element {
  const layerType = chooseSegmentationLayer ? "segmentation" : "color";
  return (
    <Form.Item
      label={label || "Layer"}
      name={name}
      rules={[
        {
          required: true,
          message: `Please select the ${layerType} layer that should be used for this job.`,
        },
      ]}
      hidden={layers.length === 1 && fixedLayerName == null}
      initialValue={fixedLayerName}
    >
      <LayerSelection
        layers={layers}
        fixedLayerName={fixedLayerName}
        layerType={layerType}
        getReadableNameForLayer={getReadableNameForLayer}
      />
    </Form.Item>
  );
}

// todop: do we really need this? we could adapt the caller, too?
export function LayerSelectionFormItemForTracing({
  name,
  chooseSegmentationLayer,
  layers,
  tracing,
  fixedLayerName,
  label,
}: Omit<LayerSelectionProps<APIDataLayer>, "getReadableNameForLayer"> & {
  tracing: HybridTracing;
}): JSX.Element {
  const layerType = chooseSegmentationLayer ? "segmentation" : "color";
  return (
    <Form.Item
      label={label || "Layer"}
      name={name}
      rules={[
        {
          required: true,
          message: `Please select the ${layerType} layer that should be used for this job.`,
        },
      ]}
      hidden={layers.length === 1 && fixedLayerName == null}
      initialValue={fixedLayerName}
    >
      <LayerSelection
        layers={layers}
        fixedLayerName={fixedLayerName}
        layerType={layerType}
        getReadableNameForLayer={(layer) =>
          getReadableNameOfVolumeLayer(layer, tracing) || layer.name
        }
      />
    </Form.Item>
  );
}
