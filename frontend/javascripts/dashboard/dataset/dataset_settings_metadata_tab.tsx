import { SettingsCard, type SettingsCardProps } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { Col, DatePicker, Form, Input, Row } from "antd";

export default function DatasetSettingsMetadataTab() {
  const metadataItems: SettingsCardProps[] = [
    {
      title: "Publication Date",
      tooltip:
        "Datasets are sorted by date. Specify the date (e.g. publication date) in order to influence the sorting order of the listed datasets in your dashboard.",
      content: (
        <Form.Item name={["dataset", "sortingKey"]}>
          <DatePicker placeholder="Select a Publication Date" />
        </Form.Item>
      ),
    },
    {
      title: "Description",
      tooltip:
        "Add a description with additional information about your dataset that will be displayed when working with this dataset. Supports Markdown formatting.",
      content: (
        <Form.Item name={["dataset", "description"]}>
          <Input.TextArea rows={3} />
        </Form.Item>
      ),
    },
  ];

  return (
    <div>
      <SettingsTitle title="Metadata" description="Add additional information about your dataset" />
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        {metadataItems.map((item) => (
          <Col span={12} key={item.title}>
            <SettingsCard title={item.title} content={item.content} tooltip={item.tooltip} />
          </Col>
        ))}
      </Row>
    </div>
  );
}
