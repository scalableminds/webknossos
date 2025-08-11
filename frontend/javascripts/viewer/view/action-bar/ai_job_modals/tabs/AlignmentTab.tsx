import { Card, Radio, Row, Space } from "antd";
import { jobNameToImagePath } from "../constants";
import { AlignSectionsForm } from "../forms/AlignSectionsForm";

export function AlignmentTab() {
  const centerImageStyle = {
    margin: "auto",
    width: 220,
  };
  return (
    <div>
      <div className="centered-items">
        <Space align="center">
          <Radio.Button className="aIJobSelection" checked={true}>
            <Card bordered={false}>
              <Space direction="vertical" size="small">
                <Row className="ai-job-title">Align Sections</Row>
                <Row>
                  <img
                    src={`/assets/images/${jobNameToImagePath.align_sections}`}
                    alt={"Example of improved alignment of slices"}
                    style={centerImageStyle}
                  />
                </Row>
              </Space>
            </Card>
          </Radio.Button>
        </Space>
      </div>
      <AlignSectionsForm />
    </div>
  );
}
