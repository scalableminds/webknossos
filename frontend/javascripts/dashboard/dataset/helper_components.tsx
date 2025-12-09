import { InfoCircleOutlined } from "@ant-design/icons";
import type { FieldError } from "@rc-component/form/es/interface";
import { Divider, Form, Modal, Tooltip } from "antd";
import type { FormItemProps, Rule } from "antd/lib/form";
import type { NamePath } from "antd/lib/form/interface";
import sum from "lodash/sum";

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

export const DividerWithSubtitle = ({ children }: { children: React.ReactNode }) => (
  <Divider style={{ margin: "18px 0" }}>{children}</Divider>
);
