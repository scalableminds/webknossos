import { InfoCircleOutlined } from "@ant-design/icons";
import { Checkbox, Form, Space, Tooltip } from "antd";
import { useWkSelector } from "libs/react_hooks";

export function ShouldUseTreesFormItem() {
  const annotation = useWkSelector((state) => state.annotation);
  const trees = annotation.skeleton ? annotation.skeleton.trees.values().toArray() : [];
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
            validator: (_rule, checked) => {
              if (checked) {
                if (annotation.annotationId === "") {
                  return Promise.reject(
                    "No annotation was found. Please create an annotation first.",
                  );
                }
                if (
                  annotation.skeleton == null ||
                  trees.filter((tree) => tree.edges.edgeCount > 0).length === 0
                ) {
                  return Promise.reject(
                    "No skeleton edges were found. Please create a skeleton with at least one edge first.",
                  );
                }
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Checkbox> Use manual matches from skeleton. </Checkbox>
      </Form.Item>
    </div>
  );
}
