import { InfoCircleOutlined } from "@ant-design/icons";
import { Checkbox, Form, Space, Tooltip } from "antd";
import type { RuleObject } from "antd/es/form";
import { useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo } from "react";

export function ShouldUseTreesFormItem() {
  const annotation = useWkSelector((state) => state.annotation);
  const trees = useMemo(
    () => (annotation.skeleton ? annotation.skeleton.trees.values().toArray() : []),
    [annotation.skeleton],
  );

  const validator = useCallback(
    (_rule: RuleObject, checked: boolean) => {
      if (checked) {
        if (annotation.annotationId === "") {
          return Promise.reject(
            new Error("No annotation was found. Please create an annotation first."),
          );
        }
        if (
          annotation.skeleton == null ||
          trees.filter((tree) => tree.edges.edgeCount > 0).length === 0
        ) {
          return Promise.reject(
            new Error(
              "No skeleton edges were found. Please create a skeleton with at least one edge first.",
            ),
          );
        }
      }
      return Promise.resolve();
    },
    [annotation, trees],
  );

  return (
    <div>
      <Form.Item
        name="useAnnotation"
        label={
          <Space>
            <div style={{}}>
              Manual Matches{" "}
              <Tooltip title="Please select whether the alignment should take connected skeleton nodes between adjacent sections as alignment guideline whenever available.">
                <InfoCircleOutlined />
              </Tooltip>
            </div>
          </Space>
        }
        valuePropName="checked"
        rules={[
          {
            validator,
          },
        ]}
      >
        <Checkbox> Use manual matches from skeleton. </Checkbox>
      </Form.Item>
    </div>
  );
}
