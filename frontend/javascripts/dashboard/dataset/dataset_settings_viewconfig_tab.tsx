import _ from "lodash";
import { InfoCircleOutlined } from "@ant-design/icons";
import {
  Form,
  Input,
  Checkbox,
  Alert,
  InputNumber,
  Col,
  Row,
  Tooltip,
  Table,
  Select,
  Slider,
  Divider,
  FormInstance,
} from "antd";
import * as React from "react";
import { Vector3Input } from "libs/vector_input";
import { validateLayerViewConfigurationObjectJSON, syncValidator } from "types/validation";
import { getDefaultLayerViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import messages, {
  RecommendedConfiguration,
  layerViewConfigurations,
  settings,
  settingsTooltips,
} from "messages";
import type { DatasetLayerConfiguration } from "oxalis/store";
import { FormItemWithInfo, jsonEditStyle } from "./helper_components";
import { BLEND_MODES } from "oxalis/constants";
import ColorLayerOrderingTable from "./color_layer_ordering_component";
import { APIDatasetId, APIDataSource } from "types/api_flow_types";
import { useGuardedFetch } from "libs/react_helpers";
import { getAgglomeratesForDatasetLayer, getMappingsForDatasetLayer } from "admin/admin_rest_api";
import { MappingSelect } from "oxalis/view/components/setting_input_views";

const FormItem = Form.Item;

function DefaultMappingSelectForLayer({
  layerName,
  datasetId,
  dataStoreURL,
  currentMapping,
  setMappingNameAndType,
}: {
  layerName: string;
  datasetId: APIDatasetId;
  dataStoreURL: string;
  currentMapping: { name: string; type: string } | null | undefined;
  setMappingNameAndType: (layerName: string, mappingName: string, mappingType: string) => void;
}) {
  const [[availableMappings, availableAgglomerates], _ignoredIsLoading] = useGuardedFetch(
    async () =>
      Promise.all([
        getMappingsForDatasetLayer(dataStoreURL, datasetId, layerName),
        getAgglomeratesForDatasetLayer(dataStoreURL, datasetId, layerName),
      ]),
    [[], []],
    [layerName, dataStoreURL, datasetId],
    messages["mapping.loading_failed"](layerName),
  );
  return (
    <Col span={6}>
      <FormItemWithInfo
        name={["defaultConfiguration", "activeMappingByLayer", layerName, "name"]}
        label={
          <span>
            Default Mapping for Layer <span className="italic">{layerName}</span>
          </span>
        }
        info="The default mapping to activate when viewing this dataset."
        initialValue={currentMapping?.name}
      >
        <MappingSelect
          isDisabled={false}
          availableMappings={availableMappings}
          availableAgglomerates={availableAgglomerates}
          onChange={(mappingName, mappingType) =>
            setMappingNameAndType(layerName, mappingName, mappingType)
          }
        />
      </FormItemWithInfo>
      {/* Rendering a hidden item for the matching mapping type to include it in the set of values output by 
       form.getFieldsValue https://ant.design/components/form#getfieldsvalue */}
      <Form.Item hidden name={["defaultConfiguration", "activeMappingByLayer", layerName, "type"]}>
        {/*Dummy input to avoid antd error*/}
        <Input type="text" />
      </Form.Item>
    </Col>
  );
}

export default function DatasetSettingsViewConfigTab(props: {
  formRef: React.RefObject<FormInstance<{ dataSource: APIDataSource }>>;
  datasetId: APIDatasetId;
  dataStoreURL: string | undefined;
}) {
  const { datasetId, dataStoreURL } = props;
  const form = props.formRef.current;
  const segmentationLayers =
    form != null
      ? (form.getFieldValue(["dataSource", "dataLayers"]) as APIDataSource["dataLayers"])?.filter(
          (layer) => layer.category === "segmentation",
        ) || []
      : [];
  const currentSelectedMappings =
    form?.getFieldValue(["defaultConfiguration", "activeMappingByLayer"]) || {};

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
  const comments: Partial<Record<keyof DatasetLayerConfiguration, string>> = {
    alpha: "20 for segmentation layer",
    min: "Only for color layers",
    max: "Only for color layers",
    intensityRange: "Only for color layers",
  };
  const layerViewConfigurationEntries = _.map(
    { ...getDefaultLayerViewConfiguration(), min: 0, max: 255, intensityRange: [0, 255] },
    (defaultValue: any, key: string) => {
      // @ts-ignore Typescript doesn't infer that key will be of type keyof DatasetLayerConfiguration
      const layerViewConfigurationKey: keyof DatasetLayerConfiguration = key;
      const name = layerViewConfigurations[layerViewConfigurationKey];
      return {
        name,
        key,
        value: defaultValue == null ? "not set" : defaultValue.toString(),
        comment: comments[layerViewConfigurationKey] || "",
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
  const setDefaultMappingNameAndType = (
    layerName: string,
    mappingName: string,
    mappingType: string,
  ) => {
    form?.setFieldValue(["defaultConfiguration", "activeMappingByLayer", layerName], {
      name: mappingName,
      type: mappingType,
    });
  };

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
            info="A zoom of &ldquo;1&rdquo; will display the data in its original resolution."
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
            label="Rotation"
            info="The default rotation that will be used in oblique and arbitrary view mode."
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
      <Row gutter={24}>
        {segmentationLayers.length > 0 && dataStoreURL != null
          ? segmentationLayers.map((layer) => (
              <DefaultMappingSelectForLayer
                layerName={layer.name}
                datasetId={datasetId}
                dataStoreURL={dataStoreURL}
                key={layer.name}
                currentMapping={currentSelectedMappings[layer.name]}
                setMappingNameAndType={setDefaultMappingNameAndType}
              />
            ))
          : null}
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
                validator: validateLayerViewConfigurationObjectJSON,
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
