import { InfoCircleOutlined } from "@ant-design/icons";
import { Col, Form, type FormInstance, InputNumber, Row, Slider, Tooltip, Typography } from "antd";
import FormItem from "antd/es/form/FormItem";
import Checkbox, { type CheckboxChangeEvent } from "antd/lib/checkbox/Checkbox";
import {
  AXIS_TO_TRANSFORM_INDEX,
  EXPECTED_TRANSFORMATION_LENGTH,
  IDENTITY_TRANSFORM,
  type RotationAndMirroringSettings,
  doAllLayersHaveTheSameRotation,
  fromCenterToOrigin,
  fromOriginToCenter,
  getRotationMatrixAroundAxis,
  transformationEqualsAffineIdentityTransform,
} from "oxalis/model/accessors/dataset_layer_transformation_accessor";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { useCallback, useEffect, useMemo } from "react";
import type { APIDataLayer } from "types/api_types";
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
    const rotationValues: {
      x: RotationAndMirroringSettings;
      y: RotationAndMirroringSettings;
      z: RotationAndMirroringSettings;
    } = form.getFieldValue(["datasetRotation"]);
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
    (rotationInDegrees: number | undefined, isMirrored?: boolean): void => {
      if (!form) {
        return;
      }
      const dataLayers: APIDataLayer[] = form.getFieldValue(["dataSource", "dataLayers"]);
      const datasetBoundingBox = getDatasetBoundingBoxFromLayers(dataLayers);
      if (datasetBoundingBox == null) {
        return;
      }
      const rotationValues: RotationAndMirroringSettings = {
        ...form.getFieldValue(["datasetRotation"])[axis],
      };
      if (rotationInDegrees !== undefined) {
        rotationValues.rotationInDegrees = rotationInDegrees;
      }
      if (isMirrored !== undefined) {
        rotationValues.isMirrored = isMirrored;
      }
      const rotationMatrix = getRotationMatrixAroundAxis(axis, rotationValues);
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
        const updatedTransformations = transformationEqualsAffineIdentityTransform(transformations)
          ? null
          : transformations;

        return {
          ...layer,
          coordinateTransformations: updatedTransformations,
        };
      });
      form.setFieldValue(["dataSource", "dataLayers"], dataLayersWithUpdatedTransforms);
    },
    [axis, form],
  );
  return (
    <Row gutter={24}>
      <Col span={8}>
        <FormItemWithInfo
          name={["datasetRotation", axis, "rotationInDegrees"]}
          label={`${axis.toUpperCase()} Axis Rotation`}
          info={`Change the datasets rotation around the ${axis}-axis.`}
          colon={false}
        >
          <Slider min={0} max={270} step={90} onChange={setMatrixRotationsForAllLayer} />
        </FormItemWithInfo>
      </Col>
      <Col span={4} style={{ marginRight: -12 }}>
        <FormItem
          name={["datasetRotation", axis, "rotationInDegrees"]}
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
      <Col span={4} style={{ marginRight: -12 }}>
        <FormItem
          name={["datasetRotation", axis, "isMirrored"]}
          colon={false}
          valuePropName="checked"
          label={`Mirror ${axis.toUpperCase()} Axis`} /* Whitespace label is needed for correct formatting*/
        >
          <Checkbox
            onChange={(evt: CheckboxChangeEvent) =>
              setMatrixRotationsForAllLayer(undefined, evt.target.checked)
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

export type DatasetRotationAndMirroringSettings = {
  x: RotationAndMirroringSettings;
  y: RotationAndMirroringSettings;
  z: RotationAndMirroringSettings;
};

export const AxisRotationSettingForDataset: React.FC<AxisRotationSettingForDatasetProps> = ({
  form,
}: AxisRotationSettingForDatasetProps) => {
  // form -> dataSource -> dataLayers can be undefined in case of the add remote dataset form which is initially empty.
  const dataLayers: APIDataLayer[] | undefined = form?.getFieldValue(["dataSource", "dataLayers"]);
  const isRotationOnly = useMemo(
    () => (dataLayers ? doAllLayersHaveTheSameRotation(dataLayers) : false),
    [dataLayers],
  );
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
