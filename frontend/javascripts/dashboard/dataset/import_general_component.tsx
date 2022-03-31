import { Input, Col, Row, DatePicker } from "antd";
import React from "react";
import { FormItemWithInfo } from "./helper_components";
export default function ImportGeneralComponent() {
  return (
    <div>
      <Row gutter={48}>
        <Col span={12}>
          <FormItemWithInfo
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; name: string[]; label: ... Remove this comment to see the full error message
            name={["dataset", "displayName"]}
            label="Display Name"
            info="Add a descriptive name for your dataset instead of the technical name."
          >
            <Input placeholder="Display Name" />
          </FormItemWithInfo>
        </Col>
        <Col span={12}>
          <FormItemWithInfo
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; name: string[]; label: ... Remove this comment to see the full error message
            name={["dataset", "description"]}
            label="Description"
            info="Add a description with additional information about your dataset. Format with Markdown."
          >
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type
            'number | ... Remove this comment to see the full error message
            <Input.TextArea rows="3" placeholder="Description" />
          </FormItemWithInfo>
        </Col>
      </Row>
      <FormItemWithInfo
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; name: string[]; label: ... Remove this comment to see the full error message
        name={["dataset", "sortingKey"]}
        label="Sorting Date"
        info="Datasets are sorted by date. Specify the date (e.g. publication date) in order to influence the sorting order."
      >
        <DatePicker placeholder="Select a Publication Date" />
      </FormItemWithInfo>
    </div>
  );
}
