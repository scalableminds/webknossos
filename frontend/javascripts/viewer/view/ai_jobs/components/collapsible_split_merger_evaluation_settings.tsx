import { Checkbox, Col, Collapse, Form, InputNumber, Row } from "antd";
import { useCallback } from "react";

export type SplitMergerEvaluationSettings = {
  useSparseTracing?: boolean;
  maxEdgeLength?: number;
  sparseTubeThresholdInNm?: number;
  minimumMergerPathLengthInNm?: number;
};

export function CollapsibleSplitMergerEvaluationSettings({
  isActive = false,
  setActive,
}: { isActive: boolean; setActive: (active: boolean) => void }) {
  const handleCollapseChange = useCallback(() => setActive(!isActive), [isActive, setActive]);

  return (
    <Collapse
      style={{ marginBottom: 8 }}
      onChange={handleCollapseChange}
      expandIcon={() => <Checkbox checked={isActive} />}
      ghost
      items={[
        {
          key: "evaluation",
          label: "Evaluation Settings",
          children: (
            <Row>
              <Col style={{ width: "100%" }}>
                <div style={{ marginBottom: 24 }}>
                  You can evaluate splits/mergers on a given bounding box. <br />
                  By default this is the user defined bounding box or the bounding box of a task.{" "}
                  <br />
                  Thus your annotation should contain
                  <ul>
                    <li> either one user defined bounding box or the bounding box of a task</li>
                    <li>
                      with at least one neuron (sparse) or all neurons (dense) annotated as
                      skeletons.
                    </li>
                  </ul>
                </div>
                <Form.Item
                  layout="horizontal"
                  label="Use sparse ground truth tracing"
                  name={["splitMergerEvaluationSettings", "useSparseTracing"]}
                  valuePropName="checked"
                  initialValue={true}
                  tooltip="The evaluation mode can either be `dense`
    in case all processes in the volume are annotated in the ground-truth.
    If not, use the `sparse` mode."
                >
                  <Checkbox style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item
                  label="Max edge length in nm"
                  name={["splitMergerEvaluationSettings", "maxEdgeLength"]}
                  tooltip="Ground truth tracings can be densified so that
    nodes are at most max_edge_length nm apart.
    However, this can also introduce wrong nodes in curved processes."
                >
                  <InputNumber style={{ width: "100%" }} placeholder="None" />
                </Form.Item>
                <Form.Item
                  label="Sparse tube threshold in nm"
                  name={["splitMergerEvaluationSettings", "sparseTubeThresholdInNm"]}
                  tooltip="Tube threshold for sparse evaluation,
    determining if a process is too far from the ground-truth."
                >
                  <InputNumber style={{ width: "100%" }} placeholder="1000" />
                </Form.Item>
                <Form.Item
                  label="Sparse minimum merger path length in nm"
                  name={["splitMergerEvaluationSettings", "minimumMergerPathLengthInNm"]}
                  tooltip="Minimum ground truth path length of a merger component
    to be counted as a relevant merger (for sparse evaluation).
    Note, the path length to neighboring nodes of a component is included for this comparison. This optimistic path length
    estimation makes sure no relevant mergers are ignored."
                >
                  <InputNumber style={{ width: "100%" }} placeholder="800" />
                </Form.Item>
              </Col>
            </Row>
          ),
        },
      ]}
      activeKey={isActive ? "evaluation" : []}
    />
  );
}
