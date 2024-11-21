import { InfoCircleOutlined } from "@ant-design/icons";
import { type FormInstance, Row, Col, Slider, InputNumber, Tooltip, Typography } from "antd";
import FormItem from "antd/es/form/FormItem";
import { haveAllLayersSameRotation } from "oxalis/model/accessors/dataset_accessor";
import { useCallback, useMemo } from "react";
import type { APIDataLayer } from "types/api_flow_types";
import { FormItemWithInfo } from "./helper_components";
import {
  getRotationMatrixAroundAxis,
  getTranslationToOrigin,
  IDENTITY_TRANSFORM,
  getTranslationBackToOriginalPosition,
  AXIS_TO_TRANSFORM_INDEX,
} from "oxalis/model/accessors/dataset_layer_rotation_accessor";

const { Text } = Typography;

type AxisRotationFormItemProps = {
  form: FormInstance | undefined;
  axis: "x" | "y" | "z";
};

export const AxisRotationFormItem: React.FC<AxisRotationFormItemProps> = ({
  form,
  axis,
}: AxisRotationFormItemProps) => {
  const setMatrixRotationsForAllLayer = useCallback(
    (rotationInDegrees: number): void => {
      const rotationInRadians = rotationInDegrees * (Math.PI / 180);
      const rotationMatrix = getRotationMatrixAroundAxis(axis, rotationInRadians);
      const dataLayers: APIDataLayer[] = form?.getFieldValue(["dataSource", "dataLayers"]);

      const dataLayersWithUpdatedTransforms: APIDataLayer[] = dataLayers.map((layer) => {
        let transformations = layer.coordinateTransformations;
        const boundingBox = layer.boundingBox; // TODOM: The bounding bix for the translation should eb the dataset bbox and not the layer's.
        if (transformations == null || transformations.length !== 5) {
          transformations = [
            getTranslationToOrigin(boundingBox),
            IDENTITY_TRANSFORM,
            IDENTITY_TRANSFORM,
            IDENTITY_TRANSFORM,
            getTranslationBackToOriginalPosition(boundingBox),
          ];
        }
        transformations[AXIS_TO_TRANSFORM_INDEX[axis]] = rotationMatrix;
        return {
          ...layer,
          coordinateTransformations: transformations,
        };
      });
      form?.setFieldValue(["dataSource", "dataLayers"], dataLayersWithUpdatedTransforms);
    },
    [axis, form],
  );
  return (
    <Row gutter={24}>
      <Col span={16}>
        <FormItemWithInfo
          name={["datasetRotation", axis]}
          label={`${axis.toUpperCase()} Axis Rotation`}
          info={`Change the datasets rotation around the ${axis}-axis.`}
          colon={false}
        >
          <Slider min={0} max={270} step={90} onChange={setMatrixRotationsForAllLayer} />
        </FormItemWithInfo>
      </Col>
      <Col span={8} style={{ marginRight: -12 }}>
        <FormItem
          name={["datasetRotation", axis]}
          colon={false}
          label=" " /* Empty label is useful for correct formatting*/
        >
          <InputNumber
            min={0}
            max={270}
            step={90}
            precision={0}
            onChange={(value: number | null) => value && setMatrixRotationsForAllLayer(value)}
          />
        </FormItem>
      </Col>
    </Row>
  );
};

type AxisRotationSettingForDatasetProps = {
  form: FormInstance | undefined;
};

export type DatasetRotation = {
  x: number;
  y: number;
  z: number;
};

export const AxisRotationSettingForDataset: React.FC<AxisRotationSettingForDatasetProps> = ({
  form,
}: AxisRotationSettingForDatasetProps) => {
  const dataLayers: APIDataLayer[] = form?.getFieldValue(["dataSource", "dataLayers"]);
  const isRotationOnly = useMemo(() => haveAllLayersSameRotation(dataLayers), [dataLayers]);

  if (!isRotationOnly) {
    return (
      <Tooltip
        title={
          <div>
            Each layers transformations must be equal and each layer needs exactly 5 affine
            transformation with the following schema:
            <ul>
              <li>Translation to the origin</li>
              <li>Rotation around the x-axis</li>
              <li>Rotation around the y-axis</li>
              <li>Rotation around the z-axis</li>
              <li>Translation back to the original position</li>
            </ul>
            To easily enable this setting, delete all coordinateTransformations of all layers in the
            advanced tab, save and reload.
          </div>
        }
      >
        <Text type="secondary">
          Setting a dataset's rotation is only supported when all layers have the same rotation
          transformation. <InfoCircleOutlined />
        </Text>
      </Tooltip>
    );
  }

  return (
    <div>
      <AxisRotationFormItem form={form} axis="x" />
      <AxisRotationFormItem form={form} axis="y" />
      <AxisRotationFormItem form={form} axis="z" />
    </div>
  );
};
