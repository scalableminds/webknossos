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
import { useCallback } from "react";
import { flatToNestedMatrix } from "oxalis/model/accessors/dataset_accessor";

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
  index: number;
  axis: "x" | "y" | "z";
};

const IDENTITY_MATRIX = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
] as NestedMatrix4;

export const AxisRotationFormItem: React.FC<AxisRotationFormItemProps> = ({
  form,
  index,
  axis,
}: AxisRotationFormItemProps) => {
  const coordinateTransformations: CoordinateTransformation[] = form?.getFieldValue([
    "dataSource",
    "dataLayers",
    index,
    "coordinateTransformations",
  ]);
  const firstTransformation = coordinateTransformations?.[0];
  const deriveRotationFromMatrix = useCallback(
    (transformation: CoordinateTransformation | undefined) => {
      if (transformation && transformation.type !== "affine") {
        return;
      }
      const matrix = transformation ? transformation.matrix : IDENTITY_MATRIX;
      const rotation = new THREE.Quaternion();
      const affineTransformationMatrix = new THREE.Matrix4();
      affineTransformationMatrix.fromArray(nestedToFlatMatrix(matrix));
      affineTransformationMatrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
      const euler = new THREE.Euler().setFromQuaternion(rotation);
      return euler[axis] * (180 / Math.PI);
    },
    [axis],
  );
  const matrixWithUpdatedRotation = useCallback(
    (rotation: number): CoordinateTransformation => {
      const matrix: NestedMatrix4 =
        firstTransformation && firstTransformation.type === "affine" && firstTransformation?.matrix
          ? firstTransformation.matrix
          : IDENTITY_MATRIX;
      const newMatrix = new THREE.Matrix4().fromArray(nestedToFlatMatrix(matrix));
      const translation = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      newMatrix.decompose(translation, quaternion, scale);
      const euler = new THREE.Euler().setFromQuaternion(quaternion);
      euler[axis] = rotation * (Math.PI / 180);
      quaternion.setFromEuler(euler);
      newMatrix.compose(translation, quaternion, scale);
      const newMatrixArray = newMatrix.toArray();
      return { type: "affine", matrix: flatToNestedMatrix(newMatrixArray) };
    },
    [firstTransformation, axis],
  );
  if (coordinateTransformations && coordinateTransformations.length > 1) {
    return (
      <Text type="secondary">
        Setting a layers rotation is only supported for a single affine transformation. This layer
        has multiple transformations.
      </Text>
    );
  }
  if (firstTransformation && firstTransformation.type !== "affine") {
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
          name={["dataSource", "dataLayers", index, "coordinateTransformations", 0]}
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
          name={["dataSource", "dataLayers", index, "coordinateTransformations", 0]}
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
  index: number;
};
export const AxisRotationSettingForLayer: React.FC<AxisRotationSettingForLayerProps> = ({
  form,
  index,
}: AxisRotationSettingForLayerProps) => {
  return (
    <div>
      <AxisRotationFormItem form={form} index={index} axis="x" />
      <AxisRotationFormItem form={form} index={index} axis="y" />
      <AxisRotationFormItem form={form} index={index} axis="z" />
    </div>
  );
};
