import { InfoCircleOutlined } from "@ant-design/icons";
import { getAgglomeratesForDatasetLayer, getMappingsForDatasetLayer } from "admin/admin_rest_api";
import {
  Alert,
  Checkbox,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Table,
  Tooltip,
} from "antd";
import { Slider } from "components/slider";
import { Vector3Input } from "libs/vector_input";
import _ from "lodash";
import messages, {
  type RecommendedConfiguration,
  layerViewConfigurations,
  settings,
  settingsTooltips,
} from "messages";
import { BLEND_MODES } from "oxalis/constants";
import type { DatasetConfiguration, DatasetLayerConfiguration } from "oxalis/store";
import { useMemo, useState } from "react";
import type { APIDataSourceId } from "types/api_flow_types";
import { getDefaultLayerViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import { syncValidator, validateLayerViewConfigurationObjectJSON } from "types/validation";
import ColorLayerOrderingTable from "./color_layer_ordering_component";
import { FormItemWithInfo, jsonEditStyle } from "./helper_components";

const FormItem = Form.Item;

export default function DatasetSettingsViewConfigTab(props: {
  dataSourceId: APIDataSourceId;
  dataStoreURL: string | undefined;
}) {
  const { dataSourceId, dataStoreURL } = props;
  const [availableMappingsPerLayerCache, setAvailableMappingsPerLayer] = useState<
    Record<string, [string[], string[]]>
  >({});

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
    [availableMappingsPerLayerCache],
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
  const checkboxSettings = (
    [
      ["interpolation", 6],
      ["fourBit", 6],
      ["renderMissingDataBlack", 6],
    ] as Array<[keyof RecommendedConfiguration, number]>
  ).map(([settingsName, spanWidth]) => (
    <Col span={spanWidth} key={settingsName}>
      <FormItem name={["defaultConfiguration", settingsName]} valuePropName="checked" colon={false}>
        <Checkbox>
          {settings[settingsName]}{" "}
          <Tooltip title={settingsTooltips[settingsName]}>
            <InfoCircleOutlined
              style={{
                color: "gray",
              }}
            />
          </Tooltip>
        </Checkbox>
      </FormItem>
    </Col>
  ));

  return (
    <div>
      <Alert
        message="The following settings define the default configuration when viewing or creating an explorational annotation for this dataset. Use them to optimize the first appearance of your dataset."
        type="info"
        style={{ marginBottom: 8 }}
        showIcon
      />
      <Row gutter={24}>
        <Col span={6}>
          <FormItemWithInfo
            name={["defaultConfiguration", "position"]}
            label="Position"
            info="The default position is defined in voxel-coordinates (x, y, z)."
          >
            <Vector3Input />
          </FormItemWithInfo>
        </Col>
        <Col span={6}>
          <FormItemWithInfo
            name={["defaultConfiguration", "zoom"]}
            label="Zoom"
            info="A zoom of &ldquo;1&rdquo; will display the data in its original magnification."
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
            />
          </FormItemWithInfo>
        </Col>
        <Col span={6}>
          <FormItemWithInfo
            name={["defaultConfiguration", "rotation"]}
            label="Rotation - Arbitrary View Modes"
            info="The default rotation that will be used in oblique and flight view mode."
          >
            <Vector3Input />
          </FormItemWithInfo>
        </Col>
      </Row>
      <Row gutter={24}>{checkboxSettings}</Row>
      <Row gutter={24}>
        <Col span={6}>
          <Row gutter={24}>
            <Col span={16}>
              <FormItemWithInfo
                name={["defaultConfiguration", "segmentationPatternOpacity"]}
                label={settings.segmentationPatternOpacity}
                info={settingsTooltips.segmentationPatternOpacity}
                colon={false}
              >
                <Slider min={0} max={100} step={1} />
              </FormItemWithInfo>
            </Col>
            <Col span={8} style={{ marginRight: -12 }}>
              <FormItem
                name={["defaultConfiguration", "segmentationPatternOpacity"]}
                colon={false}
                label=" "
              >
                <InputNumber min={0} max={100} step={1} precision={0} />
              </FormItem>
            </Col>
          </Row>
        </Col>
        <Col span={6}>
          <FormItemWithInfo
            colon={false}
            name={["defaultConfiguration", "blendMode"]}
            label={settings.blendMode}
            info={settingsTooltips.blendMode}
          >
            <Select allowClear>
              <Select.Option value={BLEND_MODES.Additive}>Additive</Select.Option>
              <Select.Option value={BLEND_MODES.Cover}>Cover</Select.Option>
            </Select>
          </FormItemWithInfo>
        </Col>
        <Col span={6}>
          <FormItemWithInfo
            colon={false}
            name={["defaultConfiguration", "loadingStrategy"]}
            label={settings.loadingStrategy}
            info={settingsTooltips.loadingStrategy}
          >
            <Select allowClear>
              <Select.Option value={"BEST_QUALITY_FIRST"}>Best quality first</Select.Option>
              <Select.Option value={"PROGRESSIVE_QUALITY"}>Progressive quality</Select.Option>
            </Select>
          </FormItemWithInfo>
        </Col>
      </Row>
      <Row gutter={24}>
        <Col span={6}>
          <FormItem
            name={["defaultConfiguration", "colorLayerOrder"]}
            valuePropName="colorLayerNames"
          >
            <ColorLayerOrderingTable />
          </FormItem>
        </Col>
      </Row>
      <Divider />
      <Row gutter={32}>
        <Col span={12}>
          <FormItemWithInfo
            name="defaultConfigurationLayersJson"
            label="Layer Configuration"
            info="Use the following JSON to define layer-specific properties, such as color, alpha and intensityRange."
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
          </FormItemWithInfo>
        </Col>
        <Col span={12}>
          Valid layer view configurations and their default values:
          <br />
          <br />
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
        </Col>
      </Row>
    </div>
  );
}
