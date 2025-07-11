import { InfoCircleOutlined } from "@ant-design/icons";
import { Alert, Form, Modal, Tooltip } from "antd";
import type { FormItemProps, Rule } from "antd/lib/form";
import type { NamePath } from "antd/lib/form/interface";
import { sum } from "lodash";
import type { FieldError } from "rc-field-form/es/interface";
import React from "react";

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
  return sum(errorsForKey) > 0;
};
