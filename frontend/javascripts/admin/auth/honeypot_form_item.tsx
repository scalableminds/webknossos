import { Form, Input } from "antd";

const FormItem = Form.Item;

// Invisible to real users, but a bot that blindly fills every input will populate it,
// letting the backend silently reject the submission.
export function HoneypotFormItem() {
  return (
    <div
      style={{
        position: "absolute",
        left: "-9999px",
        top: "-9999px",
        height: 0,
        width: 0,
        overflow: "hidden",
      }}
    >
      <FormItem name="phone" initialValue="">
        <Input type="text" tabIndex={-1} autoComplete="off" />
      </FormItem>
    </div>
  );
}
