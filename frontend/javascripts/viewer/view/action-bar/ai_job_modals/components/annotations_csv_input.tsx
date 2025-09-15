import { Button, Form, Input, Space } from "antd";
import type { RuleObject } from "antd/es/form";
import { useCallback } from "react";
import type { AiTrainingAnnotationSelection } from "../../../ai_jobs/train_ai_model/ai_training_job_context";
import { useAiTrainingJobContext } from "../../../ai_jobs/train_ai_model/ai_training_job_context";
import { fetchAnnotationInfos } from "./fetch_annotation_infos";

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
      const newSelections: AiTrainingAnnotationSelection[] = newItems.map((item) => ({
        annotation: item.annotation,
        dataset: item.dataset,
        userBoundingBoxes: item.userBoundingBoxes,
      }));

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
    const valid = text.split("\n").every((line) => !line.includes("#") && !line.includes(","));

    return valid
      ? Promise.resolve()
      : Promise.reject(
          new Error("Each line should only contain a single annotation ID or URL (without # or ,)"),
        );
  }, []);

  return (
    <div style={{ width: 300 }}>
      <Form form={form} initialValues={{ annotations: "" }} onFinish={handleSubmit}>
        <Form.Item
          name="annotations"
          hasFeedback
          rules={[{ validator }]}
          validateTrigger={["onChange", "onBlur"]}
        >
          <Input.TextArea
            className="input-monospace"
            placeholder="Enter a annotation/task ID or WEBKNOSSOS URL"
            autoSize={{ minRows: 6 }}
            style={{ fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace' }}
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
