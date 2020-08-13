// @flow

import { Input, Col, Row, DatePicker } from "antd";
import React from "react";

import { FormItemWithInfo } from "./helper_components";

type Props = {
  form: Object,
};

export default function ImportGeneralComponent({ form }: Props) {
  const { getFieldDecorator } = form;

  return (
    <div>
      <Row gutter={48}>
        <Col span={12}>
          <FormItemWithInfo
            label="Display Name"
            info="Add a descriptive name for your dataset instead of the technical name."
          >
            {getFieldDecorator("dataset.displayName")(<Input placeholder="Display Name" />)}
          </FormItemWithInfo>
        </Col>
        <Col span={12}>
          <FormItemWithInfo
            label="Description"
            info="Add a description with additional information about your dataset. Format with Markdown."
          >
            {getFieldDecorator("dataset.description")(
              <Input.TextArea rows="3" placeholder="Description" />,
            )}
          </FormItemWithInfo>
        </Col>
      </Row>
      <FormItemWithInfo
        label="Sorting Date"
        info="Datasets are sorted by date. Specify the date (e.g. publication date) in order to influence the sorting order."
      >
        {getFieldDecorator("dataset.sortingKey")(
          <DatePicker placeholder="Select a Publication Date" />,
        )}
      </FormItemWithInfo>
    </div>
  );
}
