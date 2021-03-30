// @flow
import { Alert, Form, Tooltip, Modal } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";

const FormItem = Form.Item;

export const jsonEditStyle = {
  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
};

export function Hideable({ children, hidden }: { children: React.Node, hidden: boolean }) {
  return <div style={{ display: hidden ? "none" : "block" }}>{children}</div>;
}

export const FormItemWithInfo = ({
  label,
  info,
  children,
  ...props
}: {
  label: React.Node,
  info: React.Node,
  children: React.Node,
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

export class RetryingErrorBoundary extends React.Component<
  { children: React.Node },
  { error: ?Error },
> {
  constructor() {
    super();
    this.state = { error: null };
  }

  componentWillReceiveProps() {
    this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    this.setState({ error });
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

export const confirmAsync = (opts: Object): Promise<boolean> =>
  new Promise(resolve => {
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

const gatherErrors = obj => {
  const gatherErrorsRecursive = any => {
    if (Array.isArray(any)) {
      return any.map(gatherErrorsRecursive);
    } else if (any instanceof Error) {
      return any;
    } else if (typeof any === "string") {
      return any;
    } else if (any instanceof Object) {
      return Object.keys(any).map(key => gatherErrorsRecursive(any[key]));
    } else {
      return null;
    }
  };
  return _.compact(_.flattenDeep([gatherErrorsRecursive(obj)]));
};

export const hasFormError = (obj: Object) => obj && !_.isEmpty(gatherErrors(obj));
