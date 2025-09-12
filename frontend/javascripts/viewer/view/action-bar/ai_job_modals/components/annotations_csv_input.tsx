import { Form, Input } from "antd";
import type { RuleObject } from "antd/es/form";
import { useCallback } from "react";

const { TextArea } = Input;

export function AnnotationsCsvInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const validator = useCallback((_rule: RuleObject, value: string) => {
    const valid = value.split("\n").every((line) => !line.includes("#") && !line.includes(","));

    return valid
      ? Promise.resolve()
      : Promise.reject(
          new Error("Each line should only contain an annotation ID or URL (without # or ,)"),
        );
  }, []);

  return (
    <Form.Item
      name="annotationCsv"
      label="Annotations or Tasks CSV"
      hasFeedback
      initialValue={value}
      rules={[{ validator }]}
    >
      <TextArea
        className="input-monospace"
        placeholder="Enter a annotation/task ID or WEBKNOSSOS URL"
        autoSize={{
          minRows: 6,
        }}
        style={{
          fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
        }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Form.Item>
  );
}
