import { InfoCircleOutlined } from "@ant-design/icons";
import { Col, Form, type FormInstance, InputNumber, Row, Slider, Tooltip, Typography } from "antd";
import FormItem from "antd/es/form/FormItem";
import {
  AXIS_TO_TRANSFORM_INDEX,
  EXPECTED_TRANSFORMATION_LENGTH,
  IDENTITY_TRANSFORM,
  doAllLayersHaveTheSameRotation,
  fromCenterToOrigin,
  fromOriginToCenter,
  getRotationMatrixAroundAxis,
} from "oxalis/model/accessors/dataset_layer_transformation_accessor";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { useCallback, useEffect, useMemo } from "react";
import type { APIDataLayer } from "types/api_flow_types";
import { FormItemWithInfo } from "./helper_components";

const { Text } = Typography;

type AxisRotationFormItemProps = {
  form: FormInstance | undefined;
  axis: "x" | "y" | "z";
};

function getDatasetBoundingBoxFromLayers(layers: APIDataLayer[]): BoundingBox | undefined {
  if (!layers || layers.length === 0) {
    return undefined;
  }
  let datasetBoundingBox = BoundingBox.fromBoundBoxObject(layers[0].boundingBox);
  for (let i = 1; i < layers.length; i++) {
    datasetBoundingBox = datasetBoundingBox.extend(
      BoundingBox.fromBoundBoxObject(layers[i].boundingBox),
    );
  }
  return datasetBoundingBox;
}

export const AxisRotationFormItem: React.FC<AxisRotationFormItemProps> = ({
  form,
  axis,
}: AxisRotationFormItemProps) => {
  const dataLayers: APIDataLayer[] = Form.useWatch(["dataSource", "dataLayers"], form);
  const datasetBoundingBox = useMemo(
    () => getDatasetBoundingBoxFromLayers(dataLayers),
    [dataLayers],
  );
  // Update the transformations in case the user changes the dataset bounding box.
  useEffect(() => {
    if (
      datasetBoundingBox == null ||
      dataLayers[0].coordinateTransformations?.length !== EXPECTED_TRANSFORMATION_LENGTH ||
      !form
    ) {
      return;
    }
    const rotationValues = form.getFieldValue(["datasetRotation"]);
    const transformations = [
      fromCenterToOrigin(datasetBoundingBox),
      getRotationMatrixAroundAxis("x", rotationValues["x"]),
      getRotationMatrixAroundAxis("y", rotationValues["y"]),
      getRotationMatrixAroundAxis("z", rotationValues["z"]),
      fromOriginToCenter(datasetBoundingBox),
    ];
    const dataLayersWithUpdatedTransforms = dataLayers.map((layer) => {
      return {
        ...layer,
        coordinateTransformations: transformations,
      };
    });
    form.setFieldValue(["dataSource", "dataLayers"], dataLayersWithUpdatedTransforms);
  }, [datasetBoundingBox, dataLayers, form]);

  const setMatrixRotationsForAllLayer = useCallback(
    (rotationInDegrees: number): void => {
      if (!form) {
        return;
      }
      const dataLayers: APIDataLayer[] = form.getFieldValue(["dataSource", "dataLayers"]);
      const datasetBoundingBox = getDatasetBoundingBoxFromLayers(dataLayers);
      if (datasetBoundingBox == null) {
        return;
      }

      const rotationInRadians = rotationInDegrees * (Math.PI / 180);
      const rotationMatrix = getRotationMatrixAroundAxis(axis, rotationInRadians);
      const dataLayersWithUpdatedTransforms: APIDataLayer[] = dataLayers.map((layer) => {
        let transformations = layer.coordinateTransformations;
        if (transformations == null || transformations.length !== EXPECTED_TRANSFORMATION_LENGTH) {
          transformations = [
            fromCenterToOrigin(datasetBoundingBox),
            IDENTITY_TRANSFORM,
            IDENTITY_TRANSFORM,
            IDENTITY_TRANSFORM,
            fromOriginToCenter(datasetBoundingBox),
          ];
        }
        transformations[AXIS_TO_TRANSFORM_INDEX[axis]] = rotationMatrix;
        return {
          ...layer,
          coordinateTransformations: transformations,
        };
      });
      form.setFieldValue(["dataSource", "dataLayers"], dataLayersWithUpdatedTransforms);
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
          label=" " /* Whitespace label is needed for correct formatting*/
        >
          <InputNumber
            min={0}
            max={270}
            step={90}
            precision={0}
            onChange={(value: number | null) =>
              // InputNumber might be called with null, so we need to check for that.
              value != null && setMatrixRotationsForAllLayer(value)
            }
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
  const isRotationOnly = useMemo(() => doAllLayersHaveTheSameRotation(dataLayers), [dataLayers]);

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
            advanced tab, save and reload the dataset settings.
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
