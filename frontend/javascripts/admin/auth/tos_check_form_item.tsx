import { Checkbox, Form } from "antd";
import messages from "messages";

const FormItem = Form.Item;

type TOSProps = {
  terms: {
    enabled: boolean;
    url: string;
  } | null;
};

export function TOSCheckFormItem({ terms }: TOSProps) {
  return terms == null || terms.enabled ? (
    <FormItem
      name="tos_check"
      valuePropName="checked"
      rules={[
        {
          validator: (_, value) =>
            value
              ? Promise.resolve()
              : Promise.reject(new Error(messages["auth.tos_check_required"])),
        },
      ]}
    >
      <Checkbox disabled={terms == null}>
        I agree to the{" "}
        {terms == null ? (
          "terms of service"
        ) : (
          <a target="_blank" href={terms.url} rel="noopener noreferrer">
            terms of service
          </a>
        )}
        .
      </Checkbox>
    </FormItem>
  ) : null;
}
