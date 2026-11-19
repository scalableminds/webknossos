import { InfoCircleOutlined } from "@ant-design/icons";
import type { FieldError } from "@rc-component/form/es/interface";
import { Checkbox, Divider, Form, Tooltip } from "antd";
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
// The description is antd's `extra`, which antd links to the control via aria-describedby
// and which keeps it outside of the <label> (otherwise it would become part of the
// accessible name and a click target). CSS moves it between the label and the control.
export function FormItemWithDescription({
  description,
  className,
  ...props
}: Omit<FormItemProps, "extra"> & {
  label: string;
  description: React.ReactNode;
}) {
  return (
    <FormItem
      {...props}
      className={classnames("form-item-with-description", className)}
      extra={description}
    />
  );
}

// A form item with a checkbox whose label is followed by an always-visible description.
// The description is rendered outside of the checkbox's <label> (see FormItemWithDescription),
// so that clicking it doesn't toggle the checkbox.
export function CheckboxFormItemWithDescription({
  children,
  description,
  disabled,
  className,
  ...props
}: Omit<FormItemProps, "children" | "extra" | "valuePropName"> & {
  children: React.ReactNode;
  description: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <FormItem
      {...props}
      valuePropName="checked"
      className={classnames("checkbox-form-item-with-description", className)}
      extra={description}
    >
      <Checkbox disabled={disabled}>{children}</Checkbox>
    </FormItem>
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
