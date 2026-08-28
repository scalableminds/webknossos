import { Button, Form, Input, Space } from "antd";
import type { RuleObject } from "antd/es/form";
import { useCallback } from "react";
import { fetchAnnotationInfos } from "../hooks/fetch_annotation_infos";
import {
  type AiTrainingAnnotationSelection,
  applyDefaultLayers,
  useAiTrainingJobContext,
} from "./ai_training_job_context";

export function AnnotationsCsvInput({ onClose }: { onClose: () => void }) {
  const { setSelectedAnnotations } = useAiTrainingJobContext();
  const [form] = Form.useForm();

  const handleSubmit = useCallback(async () => {
    const text: string = form.getFieldValue("annotations") ?? "";
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    if (lines.length > 0) {
      const newItems = await fetchAnnotationInfos(lines);
      const newSelections: AiTrainingAnnotationSelection[] = newItems.map((item) =>
        applyDefaultLayers({
          annotation: item.annotation,
          dataset: item.dataset,
          userBoundingBoxes: item.userBoundingBoxes,
          volumeTracings: item.volumeTracings,
          volumeTracingMags: item.volumeTracingMags,
        }),
      );

      setSelectedAnnotations((prev) => {
        const existingIds = new Set(prev.map((p) => p.annotation.id));
        const uniqueNewSelections = newSelections.filter((s) => !existingIds.has(s.annotation.id));
        return [...prev, ...uniqueNewSelections];
      });
    }

    form.resetFields(["annotations"]);
    onClose();
  }, [form, setSelectedAnnotations, onClose]);

  const handleCancel = () => {
    form.resetFields(["annotations"]);
    onClose();
  };

  const validator = useCallback((_rule: RuleObject, value?: string) => {
    const text = value ?? "";
    // A line is either a bare annotation/task ID (no # or , allowed) or a full URL (or shortlink).
    const isValidLine = (line: string) => {
      const trimmed = line.trim();
      return (
        trimmed === "" ||
        URL.canParse(trimmed) ||
        (!trimmed.includes("#") && !trimmed.includes(","))
      );
    };
    const valid = text.split("\n").every(isValidLine);

    return valid
      ? Promise.resolve()
      : Promise.reject(
          new Error(
            "Each line should only contain a single annotation/task ID or a WEBKNOSSOS URL",
          ),
        );
  }, []);

  return (
    <div>
      <Form form={form} initialValues={{ annotations: "" }} onFinish={handleSubmit}>
        <Form.Item
          name="annotations"
          hasFeedback
          rules={[{ validator }]}
          validateTrigger={["onChange", "onBlur"]}
        >
          <Input.TextArea
            placeholder="Enter a annotation/task ID or WEBKNOSSOS URL"
            autoSize={{ minRows: 6 }}
            styles={{
              textarea: {
                fontFamily:
                  'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace',
              },
            }}
          />
        </Form.Item>
        <Space style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button type="primary" htmlType="submit">
            Add
          </Button>
        </Space>
      </Form>
    </div>
  );
}
