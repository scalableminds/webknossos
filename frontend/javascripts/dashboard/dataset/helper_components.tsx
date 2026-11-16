import { InfoCircleOutlined } from "@ant-design/icons";
import type { FieldError } from "@rc-component/form/es/interface";
import { Checkbox, Divider, Form, Tooltip, Typography } from "antd";
import type { CheckboxProps } from "antd/es/checkbox";
import type { FormItemProps, Rule } from "antd/es/form";
import type { NamePath } from "antd/es/form/interface";
import classnames from "classnames";
import sum from "lodash-es/sum";

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
          <InfoCircleOutlined style={{ color: "var(--ant-color-text-description)" }} />
        </Tooltip>
      </span>
    }
  >
    {children}
  </FormItem>
);

// A form item whose label is followed by an always-visible description.
// The label must be a string so that antd can still use it in validation messages
// (antd falls back to the field name when the label is a React node).
export function FormItemWithDescription({
  label,
  description,
  messageVariables,
  className,
  ...props
}: Omit<FormItemProps, "label"> & {
  label: string;
  description: React.ReactNode;
}) {
  return (
    <FormItem
      {...props}
      className={classnames("form-item-with-description", className)}
      messageVariables={{ label, ...messageVariables }}
      label={
        <>
          {label}
          <Typography.Text
            type="secondary"
            style={{ flexBasis: "100%", fontSize: "var(--ant-font-size-sm)" }}
          >
            {description}
          </Typography.Text>
        </>
      }
    />
  );
}

// A checkbox whose label is followed by an always-visible description.
// Use it as the direct child of a Form.Item with valuePropName="checked".
export function CheckboxWithDescription({
  children,
  description,
  ...props
}: CheckboxProps & {
  description: React.ReactNode;
}) {
  return (
    // Align the box with the first line instead of centering it next to label and description.
    <Checkbox {...props} styles={{ icon: { alignSelf: "flex-start", marginTop: 3 } }}>
      {children}
      <Typography.Text
        type="secondary"
        style={{ display: "block", fontSize: "var(--ant-font-size-sm)" }}
      >
        {description}
      </Typography.Text>
    </Checkbox>
  );
}

export const hasFormError = (formErrors: FieldError[], key: string): boolean => {
  // Find the number of errors for form fields whose path starts with key
  const errorsForKey = formErrors.map((errorObj) =>
    errorObj.name[0] === key ? errorObj.errors.length : 0,
  );
  return sum(errorsForKey) > 0;
};

export const DividerWithSubtitle = ({ children }: { children: React.ReactNode }) => (
  <Divider style={{ margin: "18px 0" }}>{children}</Divider>
);
