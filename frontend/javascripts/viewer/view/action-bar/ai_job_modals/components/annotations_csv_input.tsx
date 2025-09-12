import { Button, Form, Input, Space } from "antd";
import { useCallback, useState } from "react";
import type { AiTrainingAnnotationSelection } from "../../../ai_jobs/train_ai_model/ai_training_job_context";
import { useAiTrainingJobContext } from "../../../ai_jobs/train_ai_model/ai_training_job_context";
import { fetchAnnotationInfos } from "./fetch_annotation_infos";

export function AnnotationsCsvInput({ onClose }: { onClose: () => void }) {
  const { setSelectedAnnotations } = useAiTrainingJobContext();
  const [value, setValue] = useState("");

  const handleAdd = useCallback(async () => {
    const lines = value
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

    setValue("");
    onClose();
  }, [value, setSelectedAnnotations, onClose]);

  const handleCancel = () => {
    setValue("");
    onClose();
  };

  return (
    <div style={{ width: 300 }}>
      <Form.Item label="Annotations or Tasks CSV">
        <Input.TextArea
          className="input-monospace"
          placeholder="Enter a annotation/task ID or WEBKNOSSOS URL"
          autoSize={{ minRows: 6 }}
          style={{ fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace' }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Form.Item>
      <Space style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button type="primary" onClick={handleAdd}>
          Add
        </Button>
      </Space>
    </div>
  );
}
