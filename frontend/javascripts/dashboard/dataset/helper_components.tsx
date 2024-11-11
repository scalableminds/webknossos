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
import type { CoordinateTransformation } from "types/api_flow_types";
import type { NestedMatrix4 } from "oxalis/constants";
import * as THREE from "three";
import { nestedToFlatMatrix } from "oxalis/model/helpers/transformation_helpers";
import { useCallback, useMemo } from "react";
import { flatToNestedMatrix } from "oxalis/model/accessors/dataset_accessor";
import { mod } from "libs/utils";

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
  layerIndex: number;
  axis: "x" | "y" | "z";
};

const IDENTITY_MATRIX = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
] as NestedMatrix4;

const sinusLocationOfRotationInMatrix = {
  x: [1, 2],
  y: [2, 0],
  z: [0, 1],
};

const cosinusLocationOfRotationInMatrix = {
  x: [1, 1],
  y: [0, 0],
  z: [0, 0],
};

const AXIS_TO_TRANSFORM_INDEX = {
  x: 0,
  y: 1,
  z: 2,
};

export const AxisRotationFormItem: React.FC<AxisRotationFormItemProps> = ({
  form,
  layerIndex,
  axis,
}: AxisRotationFormItemProps) => {
  const transformationIndex = AXIS_TO_TRANSFORM_INDEX[axis];
  const coordinateTransformation: CoordinateTransformation = form?.getFieldValue([
    "dataSource",
    "dataLayers",
    layerIndex,
    "coordinateTransformations",
    transformationIndex,
  ]);
  const deriveRotationFromMatrix = useCallback(
    (transformation: CoordinateTransformation | undefined) => {
      if (transformation && transformation.type !== "affine") {
        return;
      }
      const matrix = transformation ? transformation.matrix : IDENTITY_MATRIX;
      const cosinusLocation = cosinusLocationOfRotationInMatrix[axis];
      const sinusLocation = sinusLocationOfRotationInMatrix[axis];
      const sinOfAngle = matrix[sinusLocation[0]][sinusLocation[1]];
      const cosOfAngle = matrix[cosinusLocation[0]][cosinusLocation[1]];
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
    },
    [axis],
  );
  const matrixWithUpdatedRotation = useCallback(
    (rotationInDegrees: number): CoordinateTransformation => {
      const rotationInRadians = rotationInDegrees * (Math.PI / 180);
      const euler = new THREE.Euler();
      euler[axis] = rotationInRadians;
      const newMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);
      return { type: "affine", matrix: flatToNestedMatrix(newMatrix.toArray()) };
    },
    [axis],
  );
  if (coordinateTransformation && coordinateTransformation.type !== "affine") {
    return (
      <Text type="secondary">
        Setting a layers rotation is only supported for affine transformations. This layer is
        transformed via thin plate splines.
      </Text>
    );
  }
  return (
    <Row gutter={24}>
      <Col span={16}>
        <FormItemWithInfo
          name={[
            "dataSource",
            "dataLayers",
            layerIndex,
            "coordinateTransformations",
            transformationIndex,
          ]}
          label={`${axis.toUpperCase()} Axis Rotation`}
          info={`Change the datasets rotation around the ${axis}-axis.`}
          colon={false}
          getValueProps={(value) => ({ value: deriveRotationFromMatrix(value) })}
          normalize={(value) => matrixWithUpdatedRotation(value)}
        >
          <Slider min={0} max={270} step={90} />
        </FormItemWithInfo>
      </Col>
      <Col span={8} style={{ marginRight: -12 }}>
        <FormItem
          name={[
            "dataSource",
            "dataLayers",
            layerIndex,
            "coordinateTransformations",
            transformationIndex,
          ]}
          colon={false}
          label=" "
          getValueProps={(value) => ({ value: deriveRotationFromMatrix(value) })}
          normalize={(value) => matrixWithUpdatedRotation(value)}
        >
          <InputNumber min={0} max={270} step={90} precision={0} />
        </FormItem>
      </Col>
    </Row>
  );
};

type AxisRotationSettingForLayerProps = {
  form: FormInstance | undefined;
  layerIndex: number;
};

const NON_SCALED_VECTOR = new THREE.Vector3(1, 1, 1);

function hasRotationOnlyTransformations(coordinateTransformations: CoordinateTransformation[]) {
  if (coordinateTransformations == null) {
    return true;
  }
  // There should be one transformation for each axis. => A total max of 3.
  if (coordinateTransformations.length > 3) {
    return false;
  }
  const translation = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  return coordinateTransformations.every((transformation) => {
    if (transformation.type !== "affine") {
      return false;
    }
    const threeMatrix = new THREE.Matrix4().fromArray(nestedToFlatMatrix(transformation.matrix));
    threeMatrix.decompose(translation, quaternion, scale);
    const hasNoTranslationAndNoScaling =
      translation.length() === 0 && scale.equals(NON_SCALED_VECTOR);
    return hasNoTranslationAndNoScaling;
  });
}

export const AxisRotationSettingForLayer: React.FC<AxisRotationSettingForLayerProps> = ({
  form,
  layerIndex,
}: AxisRotationSettingForLayerProps) => {
  const coordinateTransformations: CoordinateTransformation[] = form?.getFieldValue([
    "dataSource",
    "dataLayers",
    layerIndex,
    "coordinateTransformations",
  ]);
  const isRotationOnly = useMemo(
    () => hasRotationOnlyTransformations(coordinateTransformations),
    [coordinateTransformations],
  );

  if (!isRotationOnly) {
    return (
      <Text type="secondary">
        Setting a layers rotation is only supported for layers with affine rotations only.
      </Text>
    );
  }

  return (
    <div>
      <AxisRotationFormItem form={form} layerIndex={layerIndex} axis="x" />
      <AxisRotationFormItem form={form} layerIndex={layerIndex} axis="y" />
      <AxisRotationFormItem form={form} layerIndex={layerIndex} axis="z" />
    </div>
  );
};
