import { InfoCircleOutlined } from "@ant-design/icons";
import { SettingsCard, type SettingsCardProps } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getAgglomeratesForDatasetLayer, getMappingsForDatasetLayer } from "admin/rest_api";
import { Col, Form, Input, InputNumber, Row, Select, Switch, Table, Tooltip } from "antd";
import { Slider } from "components/slider";
import { Vector3Input } from "libs/vector_input";
import _ from "lodash";
import messages, { layerViewConfigurations, settings, settingsTooltips } from "messages";
import { useMemo, useState } from "react";
import type { APIDataSourceId, APIDataset } from "types/api_types";
import { getDefaultLayerViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import { syncValidator, validateLayerViewConfigurationObjectJSON } from "types/validation";
import { BLEND_MODES } from "viewer/constants";
import type { DatasetConfiguration, DatasetLayerConfiguration } from "viewer/store";
import ColorLayerOrderingTable from "./color_layer_ordering_component";
import { useDatasetSettingsContext } from "./dataset_settings_context";
import { jsonEditStyle } from "./helper_components";

const FormItem = Form.Item;

export default function DatasetSettingsViewConfigTab() {
  const { dataset } = useDatasetSettingsContext();
  if (dataset == null) {
    return null;
  }
  return <DatasetSettingsViewConfigTabWithDataset dataset={dataset} />;
}

const DatasetSettingsViewConfigTabWithDataset = ({ dataset }: { dataset: APIDataset }) => {
  const [availableMappingsPerLayerCache, setAvailableMappingsPerLayer] = useState<
    Record<string, [string[], string[]]>
  >({});

  const dataStoreURL = dataset.dataStore.url;
  const dataSourceId: APIDataSourceId = {
    owningOrganization: dataset.owningOrganization,
    directoryName: dataset.directoryName,
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: validate on dataset change
  const validateDefaultMappings = useMemo(
    () => async (configStr: string, dataStoreURL: string, dataSourceId: APIDataSourceId) => {
      let config = {} as DatasetConfiguration["layers"];
      try {
        config = JSON.parse(configStr);
      } catch (e: any) {
        return Promise.reject(new Error("Invalid JSON format for : " + e.message));
      }
      const layerNamesWithDefaultMappings = Object.keys(config).filter(
        (layerName) => config[layerName].mapping != null,
      );

      const maybeMappingRequests = layerNamesWithDefaultMappings.map(async (layerName) => {
        if (layerName in availableMappingsPerLayerCache) {
          return availableMappingsPerLayerCache[layerName];
        }
        try {
          const jsonAndAgglomerateMappings = await Promise.all([
            getMappingsForDatasetLayer(dataStoreURL, dataSourceId, layerName),
            getAgglomeratesForDatasetLayer(dataStoreURL, dataSourceId, layerName),
          ]);
          setAvailableMappingsPerLayer((prev) => ({
            ...prev,
            [layerName]: jsonAndAgglomerateMappings,
          }));
          return jsonAndAgglomerateMappings;
        } catch (e: any) {
          console.error(e);
          throw new Error(messages["mapping.loading_failed"](layerName));
        }
      });
      const mappings = await Promise.all(maybeMappingRequests);
      const errors = layerNamesWithDefaultMappings
        .map((layerName, index) => {
          const [mappingsForLayer, agglomeratesForLayer] = mappings[index];
          const mappingType = config[layerName]?.mapping?.type;
          const mappingName = config[layerName]?.mapping?.name;
          const doesMappingExist =
            mappingType === "HDF5"
              ? agglomeratesForLayer.some((agglomerate) => agglomerate === mappingName)
              : mappingsForLayer.some((mapping) => mapping === mappingName);
          return doesMappingExist
            ? null
            : `The mapping "${mappingName}" of type "${mappingType}" does not exist for layer ${layerName}.`;
        })
        .filter((error) => error != null);
      if (errors.length > 0) {
        throw new Error("The following mappings are invalid: " + errors.join("\n"));
      }
    },
    [availableMappingsPerLayerCache, dataset], // Add dataset to dependencies for dataSourceId
  );

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
    },
    {
      title: "Key",
      dataIndex: "key",
    },
    {
      title: "Default Value",
      dataIndex: "value",
    },
    {
      title: "Comment",
      dataIndex: "comment",
    },
  ];
  const comments: Partial<
    Record<keyof DatasetLayerConfiguration, { shortComment: string; tooltip: string }>
  > = {
    alpha: { shortComment: "20 for segmentation layer", tooltip: "The default alpha value." },
    min: {
      shortComment: "Only for color layers",
      tooltip: "The minimum possible color range value adjustable with the histogram slider.",
    },
    max: {
      shortComment: "Only for color layers",
      tooltip: "The maximum possible color range value adjustable with the histogram slider.",
    },
    intensityRange: {
      shortComment: "Only for color layers",
      tooltip: "The color value range between which color values are interpolated and shown.",
    },
    mapping: {
      shortComment: "Active Mapping",
      tooltip:
        "The mapping whose type and name is active by default. This field is an object with the keys 'type' and 'name' like {name: 'agglomerate_65', type: 'HDF5'}.",
    },
  };
  const layerViewConfigurationEntries = _.map(
    { ...getDefaultLayerViewConfiguration(), min: 0, max: 255, intensityRange: [0, 255] },
    (defaultValue: any, key: string) => {
      // @ts-ignore Typescript doesn't infer that key will be of type keyof DatasetLayerConfiguration
      const layerViewConfigurationKey: keyof DatasetLayerConfiguration = key;
      const name = layerViewConfigurations[layerViewConfigurationKey];
      const comment = comments[layerViewConfigurationKey];
      const commentContent =
        comment != null ? (
          <Tooltip title={comment.tooltip}>
            {comment.shortComment} <InfoCircleOutlined />
          </Tooltip>
        ) : (
          ""
        );
      return {
        name,
        key,
        value: defaultValue == null ? "not set" : defaultValue.toString(),
        comment: commentContent,
      };
    },
  );

  const viewConfigItems: SettingsCardProps[] = [
    {
      title: "Position",
      tooltip: "The default position is defined in voxel-coordinates (x, y, z).",
      content: (
        <Form.Item name={["defaultConfiguration", "position"]}>
          <Vector3Input placeholder="0, 0, 0" />
        </Form.Item>
      ),
    },
    {
      title: "Zoom Level",
      tooltip:
        "A zoom level of &ldquo;1&rdquo; will display the data in its original magnification.",
      content: (
        <Form.Item
          name={["defaultConfiguration", "zoom"]}
          rules={[
            {
              validator: syncValidator(
                (value) => value == null || value > 0,
                "The zoom value must be greater than 0.",
              ),
            },
          ]}
        >
          <InputNumber
            style={{
              width: "100%",
            }}
            placeholder="1"
          />
        </Form.Item>
      ),
    },
    {
      title: "Rotation",
      tooltip: "The default rotation that will be used in oblique and flight view mode.",
      content: (
        <Form.Item name={["defaultConfiguration", "rotation"]}>
          <Vector3Input placeholder="0, 0, 0" />
        </Form.Item>
      ),
    },
    {
      title: settings.interpolation as string,
      tooltip: settingsTooltips.interpolation,
      content: (
        <Form.Item name={["defaultConfiguration", "interpolation"]} valuePropName="checked">
          <Switch />
        </Form.Item>
      ),
    },
    {
      title: settings.fourBit as string,
      tooltip: settingsTooltips.fourBit,
      content: (
        <Form.Item name={["defaultConfiguration", "fourBit"]} valuePropName="checked">
          <Switch />
        </Form.Item>
      ),
    },
    {
      title: settings.renderMissingDataBlack as string,
      tooltip: settingsTooltips.renderMissingDataBlack,
      content: (
        <Form.Item
          name={["defaultConfiguration", "renderMissingDataBlack"]}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      ),
    },
    {
      title: settings.segmentationPatternOpacity as string,
      tooltip: settingsTooltips.segmentationPatternOpacity,
      content: (
        <Row>
          <Col span={16}>
            <Form.Item name={["defaultConfiguration", "segmentationPatternOpacity"]}>
              <Slider min={0} max={100} step={1} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <FormItem name={["defaultConfiguration", "segmentationPatternOpacity"]}>
              <InputNumber min={0} max={100} step={1} precision={0} />
            </FormItem>
          </Col>
        </Row>
      ),
    },
    {
      title: settings.blendMode as string,
      tooltip: settingsTooltips.blendMode,
      content: (
        <Form.Item name={["defaultConfiguration", "blendMode"]}>
          <Select allowClear>
            <Select.Option value={BLEND_MODES.Additive}>Additive</Select.Option>
            <Select.Option value={BLEND_MODES.Cover}>Cover</Select.Option>
          </Select>
        </Form.Item>
      ),
    },
    {
      title: settings.loadingStrategy as string,
      tooltip: settingsTooltips.loadingStrategy,
      content: (
        <Form.Item name={["defaultConfiguration", "loadingStrategy"]}>
          <Select allowClear>
            <Select.Option value={"BEST_QUALITY_FIRST"}>Best quality first</Select.Option>
            <Select.Option value={"PROGRESSIVE_QUALITY"}>Progressive quality</Select.Option>
          </Select>
        </Form.Item>
      ),
    },
    {
      title: "Color Layer Order",
      tooltip:
        "Set the order in which color layers are rendered. This setting is only relevant if the cover blend mode is active.",
      content: (
        <Form.Item name={["defaultConfiguration", "colorLayerOrder"]}>
          <ColorLayerOrderingTable />
        </Form.Item>
      ),
    },
  ];

  return (
    <div>
      <SettingsTitle
        title="View Configuration"
        description="Define the default view configuration values and optimize the initial appearance of this dataset."
      />
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        {viewConfigItems.map((item) => (
          <Col span={8} key={item.title}>
            <SettingsCard title={item.title} content={item.content} tooltip={item.tooltip} />
          </Col>
        ))}
      </Row>

      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <SettingsCard
            title="Layer Configuration"
            tooltip="Define layer-specific properties, such as color, alpha and intensityRange in JSON format"
            content={
              <Form.Item
                name="defaultConfigurationLayersJson"
                rules={[
                  {
                    validator: (_rule, config: string) =>
                      Promise.all([
                        validateLayerViewConfigurationObjectJSON(_rule, config),
                        dataStoreURL
                          ? validateDefaultMappings(config, dataStoreURL, dataSourceId)
                          : Promise.resolve(),
                      ]),
                  },
                ]}
              >
                <Input.TextArea rows={18} style={jsonEditStyle} />
              </Form.Item>
            }
          />
        </Col>
        <Col span={12}>
          <SettingsCard
            title="Valid layer view configurations and their default values"
            tooltip="The default values are defined in the dataset's properties."
            content={
              <Table
                columns={columns}
                dataSource={layerViewConfigurationEntries}
                size="small"
                pagination={false}
                className="large-table"
                scroll={{
                  x: "max-content",
                }}
              />
            }
          />
        </Col>
      </Row>
    </div>
  );
};
