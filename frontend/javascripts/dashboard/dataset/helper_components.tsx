import {
  Alert,
  Form,
  Tooltip,
  Modal,
  Col,
  InputNumber,
  Row,
  Slider,
  Typography,
  type FormInstance,
} from "antd";
import type { FieldError } from "rc-field-form/es/interface";
import { InfoCircleOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import type { NamePath } from "antd/lib/form/interface";
import type { FormItemProps, Rule } from "antd/lib/form";
import type {
  AffineTransformation,
  APIDataLayer,
  CoordinateTransformation,
} from "types/api_flow_types";
import type { NestedMatrix4 } from "oxalis/constants";
import * as THREE from "three";
import { nestedToFlatMatrix } from "oxalis/model/helpers/transformation_helpers";
import { useCallback, useMemo } from "react";
import { flatToNestedMatrix } from "oxalis/model/accessors/dataset_accessor";
import { mod } from "libs/utils";
import type { BoundingBoxObject } from "oxalis/store";
import { V3 } from "libs/mjs";

const { Text } = Typography;

const FormItem = Form.Item;

export const jsonEditStyle = {
  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
};

export function Hideable({ children, hidden }: { children: React.ReactNode; hidden: boolean }) {
  return (
    <div
      style={{
        display: hidden ? "none" : "block",
      }}
    >
      {children}
    </div>
  );
}

export const FormItemWithInfo = ({
  label,
  info,
  children,
  ...props
}: FormItemProps & {
  info: React.ReactNode;
  children: React.ReactNode;
  name?: NamePath;
  initialValue?: string;
  rules?: Rule[];
  valuePropName?: string;
  validateFirst?: boolean;
}) => (
  <FormItem
    {...props}
    colon={false}
    label={
      <span>
        {label}{" "}
        <Tooltip title={info}>
          <InfoCircleOutlined style={{ color: "gray" }} />
        </Tooltip>
      </span>
    }
  >
    {children}
  </FormItem>
);

type Props = {
  children: React.ReactNode;
};

export class RetryingErrorBoundary extends React.Component<
  Props,
  {
    error: Error | null | undefined;
  }
> {
  constructor(props: Props) {
    super(props);
    this.state = {
      error: null,
    };
  }

  // This cannot be changed to componentDidUpdate, because we cannot distinguish whether the parent
  // component actually changed
  UNSAFE_componentWillReceiveProps() {
    this.setState({
      error: null,
    });
  }

  componentDidCatch(error: Error) {
    this.setState({
      error,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <Alert
          type="error"
          showIcon
          message={
            <span>
              An error occurred while processing the configuration. Ensure that the JSON is valid.
              {this.state.error.toString()}
            </span>
          }
        />
      );
    }

    return this.props.children;
  }
}
export const confirmAsync = (opts: Record<string, any>): Promise<boolean> => {
  return new Promise((resolve) => {
    Modal.confirm({
      ...opts,

      onOk() {
        resolve(true);
      },

      onCancel() {
        resolve(false);
      },
    });
  });
};

export const hasFormError = (formErrors: FieldError[], key: string): boolean => {
  // Find the number of errors for form fields whose path starts with key
  const errorsForKey = formErrors.map((errorObj) =>
    errorObj.name[0] === key ? errorObj.errors.length : 0,
  );
  return _.sum(errorsForKey) > 0;
};

type AxisRotationFormItemProps = {
  form: FormInstance | undefined;
  axis: "x" | "y" | "z";
};

const IDENTITY_MATRIX = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
] as NestedMatrix4;

const IDENTITY_TRANSFORM: CoordinateTransformation = {
  type: "affine",
  matrix: IDENTITY_MATRIX,
};

const sinusLocationOfRotationInMatrix = {
  x: [2, 1],
  y: [0, 2],
  z: [1, 0],
};

const cosineLocationOfRotationInMatrix = {
  x: [1, 1],
  y: [0, 0],
  z: [0, 0],
};

const AXIS_TO_TRANSFORM_INDEX = {
  x: 1,
  y: 2,
  z: 3,
};

export function getRotationFromTransformation(
  transformation: CoordinateTransformation | undefined,
  axis: "x" | "y" | "z",
) {
  if (transformation && transformation.type !== "affine") {
    return 0;
  }
  const matrix = transformation ? transformation.matrix : IDENTITY_MATRIX;
  const cosineLocation = cosineLocationOfRotationInMatrix[axis];
  const sinusLocation = sinusLocationOfRotationInMatrix[axis];
  const sinOfAngle = matrix[sinusLocation[0]][sinusLocation[1]];
  const cosOfAngle = matrix[cosineLocation[0]][cosineLocation[1]];
  const rotation =
    Math.abs(cosOfAngle) > 1e-6
      ? Math.atan2(sinOfAngle, cosOfAngle)
      : sinOfAngle > 0
        ? Math.PI / 2
        : -Math.PI / 2;
  const rotationInDegrees = rotation * (180 / Math.PI);
  // Round to multiple of 90 degrees and keep the result positive.
  const roundedRotation = mod(Math.round((rotationInDegrees + 360) / 90) * 90, 360);
  return roundedRotation;
}

function getTranslationToOrigin(bbox: BoundingBoxObject): CoordinateTransformation {
  const center = V3.add(bbox.topLeft, V3.scale([bbox.width, bbox.height, bbox.depth], 0.5));
  const translationMatrix = new THREE.Matrix4()
    .makeTranslation(-center[0], -center[1], -center[2])
    .transpose();
  return { type: "affine", matrix: flatToNestedMatrix(translationMatrix.toArray()) };
}

function getTranslationBackToOriginalPosition(bbox: BoundingBoxObject): CoordinateTransformation {
  const center = V3.add(bbox.topLeft, V3.scale([bbox.width, bbox.height, bbox.depth], 0.5));
  const translationMatrix = new THREE.Matrix4()
    .makeTranslation(center[0], center[1], center[2])
    .transpose();
  return { type: "affine", matrix: flatToNestedMatrix(translationMatrix.toArray()) };
}
function getRotationMatrixAroundAxis(
  axis: "x" | "y" | "z",
  angleInRadians: number,
): CoordinateTransformation {
  const euler = new THREE.Euler();
  euler[axis] = angleInRadians;
  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(euler).transpose();
  return { type: "affine", matrix: flatToNestedMatrix(rotationMatrix.toArray()) };
}

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
        const boundingBox = layer.boundingBox;
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

const translation = new THREE.Vector3();
const scale = new THREE.Vector3();
const quaternion = new THREE.Quaternion();

const NON_SCALED_VECTOR = new THREE.Vector3(1, 1, 1);

function isTranslationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new THREE.Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return (
    translation.length() !== 0 &&
    scale.equals(NON_SCALED_VECTOR) &&
    quaternion.equals(new THREE.Quaternion())
  );
}

function isRotationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new THREE.Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return translation.length() === 0 && scale.equals(NON_SCALED_VECTOR);
}

/* This function checks if all layers have the same transformation settings that represent
 * a translation to the dataset center and a rotation around each axis and a translation back.
 * All together this makes 5 affine transformation matrices. */
export function haveAllLayersSameRotation(dataLayers: Array<APIDataLayer>): boolean {
  const firstDataLayerTransformations = dataLayers[0]?.coordinateTransformations;
  if (firstDataLayerTransformations == null || firstDataLayerTransformations.length === 0) {
    // No transformations in all layers compatible with setting a rotation for the whole dataset.
    return dataLayers.every(
      (layer) =>
        layer.coordinateTransformations == null || layer.coordinateTransformations.length === 0,
    );
  }
  // There should be a translation to the origin, one transformation for each axis and one translation back. => A total of 5 affine transformations.
  if (
    dataLayers.some((layer) => layer.coordinateTransformations?.length !== 5) ||
    dataLayers.some((layer) =>
      layer.coordinateTransformations?.some((transformation) => transformation.type !== "affine"),
    )
  ) {
    return false;
  }

  if (
    !isTranslationOnly(firstDataLayerTransformations[0] as AffineTransformation) ||
    !isRotationOnly(firstDataLayerTransformations[1] as AffineTransformation) ||
    !isRotationOnly(firstDataLayerTransformations[2] as AffineTransformation) ||
    !isRotationOnly(firstDataLayerTransformations[3] as AffineTransformation) ||
    !isTranslationOnly(firstDataLayerTransformations[4] as AffineTransformation)
  ) {
    return false;
  }
  for (let i = 1; i < dataLayers.length; i++) {
    const transformations = dataLayers[i].coordinateTransformations;
    if (
      transformations == null ||
      // Not checking matrix 0 and 4 for equality as these are transformations depending on the layer's bounding box.
      // The bounding box can be different for each layer.
      !_.isEqual(transformations[1], firstDataLayerTransformations[1]) ||
      !_.isEqual(transformations[2], firstDataLayerTransformations[2]) ||
      !_.isEqual(transformations[3], firstDataLayerTransformations[3])
    ) {
      return false;
    }
  }
  return true;
}

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
