import { DatabaseOutlined, DeleteOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import { Badge, Button, Flex, Input, Tag, Tooltip, Typography } from "antd";
import { formatScaleValues } from "libs/format_utils";
import isEqual from "lodash-es/isEqual";
import messages from "messages";
import type { VoxelSize } from "types/api_types";
import type { DataLayer, DatasourceConfiguration } from "types/schemas/datasource.types";
import { ExploreErrorMessage } from "./explore_error_message";
import { getCredentialsLinkLabel } from "./remote_credentials";
import { RemoteCredentialsPanel } from "./remote_credentials_panel";
import { ADD_LAYERS_LABEL, EXPLORING_LABEL } from "./remote_url_step";
import { getLayerFormatLabel } from "./remote_url_utils";
import { type ExploreOptions, useRemoteUrlField } from "./use_remote_url_field";

// Where a layer was found. The datasource itself doesn't keep the URL that was explored.
export type LayerSource = { url: string; voxelSize: VoxelSize };

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function formatVoxelSize(voxelSize: VoxelSize | null | undefined): string {
  const [values, unit] = formatScaleValues(voxelSize);
  return values === "" ? "" : `${values} ${unit}`;
}

function LayerRow({
  layer,
  source,
  datasetVoxelSize,
  onRemove,
}: {
  layer: DataLayer;
  source: LayerSource | undefined;
  datasetVoxelSize: VoxelSize | undefined;
  onRemove: () => void;
}) {
  const voxelSize = source?.voxelSize ?? datasetVoxelSize;
  const hasDifferentVoxelSize =
    source != null && datasetVoxelSize != null && !isEqual(source.voxelSize, datasetVoxelSize);
  const details = [
    layer.elementClass,
    pluralize(layer.mags.length, "mag"),
    formatVoxelSize(voxelSize),
  ].join(" · ");

  return (
    <Flex align="center" gap={12} className="dataset-remote-layer-row">
      <Badge status={hasDifferentVoxelSize ? "warning" : "success"} />
      <Flex vertical className="dataset-remote-layer-name">
        <Typography.Text strong ellipsis={{ tooltip: layer.name }}>
          {layer.name}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {layer.category === "segmentation" ? "Segmentation" : "Color"}
        </Typography.Text>
      </Flex>
      <Flex vertical style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text className="dataset-remote-mono" ellipsis={{ tooltip: source?.url }}>
          {source?.url}
        </Typography.Text>
        {hasDifferentVoxelSize ? (
          <Tooltip
            title={`${messages["dataset.add_zarr_different_scale_warning"]} ${formatVoxelSize(source.voxelSize)}`}
          >
            <Typography.Text type="warning" className="dataset-remote-mono">
              {details} · differs from other layers
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary" className="dataset-remote-mono">
            {details}
          </Typography.Text>
        )}
      </Flex>
      {source != null ? (
        <Tag variant="filled" style={{ marginInlineEnd: 0 }}>
          {getLayerFormatLabel(layer, source.url)}
        </Tag>
      ) : null}
      <Tooltip title="Remove layer">
        <Button
          type="text"
          icon={<DeleteOutlined />}
          aria-label="Remove layer"
          onClick={onRemove}
        />
      </Tooltip>
    </Flex>
  );
}

/** Adds the layers found at another URL to the dataset. */
function AddLayersRow({
  exploreOptions,
  onLayersFound,
}: {
  exploreOptions: () => ExploreOptions | null;
  onLayersFound: (url: string, dataSource: DatasourceConfiguration) => void;
}) {
  const field = useRemoteUrlField();
  const { url, storage, error, isExploring, isCredentialsOpen } = field;

  const addLayers = async () => {
    const options = exploreOptions();
    if (isExploring || options == null) return;
    const dataSource = await field.exploreUrl(options);
    if (dataSource == null) return;
    onLayersFound(url.trim(), dataSource);
    field.reset();
  };

  return (
    <Flex vertical gap={10} className="dataset-remote-add-row">
      <Flex vertical gap={2}>
        <Typography.Text strong>
          <PlusOutlined className="dataset-remote-accent-icon" />
          Add layers from another URL
        </Typography.Text>
        <Typography.Text type="secondary">
          Combine data stored in different places into this dataset, for example a segmentation next
          to the raw EM. Every layer found at the URL is added to the list above.
        </Typography.Text>
      </Flex>
      <Flex gap={8}>
        <Input
          className="dataset-remote-mono"
          value={url}
          status={error != null ? "error" : undefined}
          placeholder="s3://, gs:// or https:// URL of a layer or dataset"
          // Always render a suffix: adding one while typing would remount the input and drop focus.
          suffix={
            field.format != null ? (
              <Tag color="processing" variant="filled" style={{ marginInlineEnd: 0 }}>
                {field.format}
              </Tag>
            ) : (
              <span />
            )
          }
          onChange={(event) => field.setUrl(event.target.value)}
          onPressEnter={addLayers}
        />
        <Button color="primary" variant="outlined" loading={isExploring} onClick={addLayers}>
          {isExploring ? EXPLORING_LABEL : ADD_LAYERS_LABEL}
        </Button>
      </Flex>
      {error != null ? (
        <ExploreErrorMessage
          compact
          error={error}
          storage={storage}
          hasCredentials={isCredentialsOpen}
          onAddCredentials={field.openCredentials}
        />
      ) : null}
      <Button
        type="link"
        size="small"
        icon={<LockOutlined />}
        onClick={field.toggleCredentials}
        style={{ alignSelf: "flex-start", paddingInline: 0 }}
      >
        {isCredentialsOpen ? "Remove credentials" : getCredentialsLinkLabel(storage)}
      </Button>
      {isCredentialsOpen ? (
        <div className="dataset-remote-add-row-credentials">
          <RemoteCredentialsPanel
            storage={storage}
            value={field.credentials}
            onChange={field.setCredentials}
          />
        </div>
      ) : null}
    </Flex>
  );
}

/** The layers of the new dataset, and a row to add more from other URLs. */
export function RemoteLayerList({
  datasetName,
  layers,
  layerSources,
  datasetVoxelSize,
  exploreOptions,
  onRemoveLayer,
  onLayersFound,
  onStartOver,
}: {
  datasetName: string;
  layers: DataLayer[];
  layerSources: Record<string, LayerSource>;
  datasetVoxelSize: VoxelSize | undefined;
  exploreOptions: () => ExploreOptions | null;
  onRemoveLayer: (layerName: string) => void;
  onLayersFound: (url: string, dataSource: DatasourceConfiguration) => void;
  onStartOver: () => void;
}) {
  const urlCount = new Set(Object.values(layerSources).map((source) => source.url)).size;
  const summary = [
    `${pluralize(layers.length, "layer")} from ${pluralize(urlCount, "URL")}`,
    formatVoxelSize(datasetVoxelSize),
  ]
    .filter((part) => part !== "")
    .join(" · ");

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="baseline">
        <Typography.Text strong>Layers</Typography.Text>
        <Button type="link" onClick={onStartOver} style={{ paddingInline: 0 }}>
          Start over
        </Button>
      </Flex>
      <div className="dataset-remote-layer-list">
        <Flex align="center" gap="middle" className="dataset-remote-dataset-row">
          <div className="dataset-remote-dataset-icon">
            <DatabaseOutlined />
          </div>
          <Flex vertical style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text strong ellipsis style={{ fontSize: 16 }}>
              {datasetName || "New dataset"}
            </Typography.Text>
            <Typography.Text type="secondary">{summary}</Typography.Text>
          </Flex>
        </Flex>
        {layers.map((layer) => (
          <LayerRow
            key={layer.name}
            layer={layer}
            source={layerSources[layer.name]}
            datasetVoxelSize={datasetVoxelSize}
            onRemove={() => onRemoveLayer(layer.name)}
          />
        ))}
        <AddLayersRow exploreOptions={exploreOptions} onLayersFound={onLayersFound} />
      </div>
    </Flex>
  );
}
