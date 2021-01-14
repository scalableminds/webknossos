// @flow
import { Form, Input, Button, Card } from "antd";
import React from "react";
import _ from "lodash";

import { addForeignDataSet } from "admin/admin_rest_api";
import Messages from "messages";
import Toast from "libs/toast";

const FormItem = Form.Item;
const TextArea = Input.TextArea;

type Props = {
  form: Object,
  onAdded: () => void,
};

export type ForeignDataSetSpecification = {
  +dataStoreName: string,
  +url: string,
  +dataSetName: string,
};

class DatasetAddForeignView extends React.PureComponent<Props> {
  isValidDataSet(specification: ForeignDataSetSpecification): boolean {
    if (
      !_.isString(specification.dataStoreName) ||
      !_.isString(specification.url) ||
      !_.isString(specification.dataSetName) ||
      !/^[A-Za-z0-9_-]*$/.test(specification.dataSetName) ||
      !/^https?:\/\/[a-z0-9.]+.*$/.test(specification.url)
    ) {
      return false;
    }
    return true;
  }

  splitToWords(string: string): Array<string> {
    return string
      .split(",")
      .map(word => word.trim())
      .filter(word => word !== "");
  }

  parseLine(specification: string): ForeignDataSetSpecification {
    const words = this.splitToWords(specification);
    const dataStoreName = words[0];
    const url = words[1];
    const dataSetName = words[2];

    return {
      dataStoreName,
      url,
      dataSetName,
    };
  }

  handleSubmit = async e => {
    e.preventDefault();

    const formValues = this.props.form.getFieldsValue();
    const specification = this.parseLine(formValues.foreignDatasetText);

    if (this.isValidDataSet(specification)) {
      await addForeignDataSet(
        specification.dataStoreName,
        specification.url,
        specification.dataSetName,
      );
      this.props.onAdded();
    } else {
      Toast.error(`${Messages["dataset.import.invalid_fields"]}`);
    }
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <div className="container" style={{ paddingTop: 20 }}>
        <Card title={<h3>Add Dataset</h3>} bordered={false}>
          <p>
            Specify the Dataset in the following format:
            <br />
            dataStoreName, url, dataSetName
          </p>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <FormItem label="Add Foreign Dataset Specification" hasFeedback>
              {getFieldDecorator("foreignDatasetText", {
                rules: [
                  {
                    validator: (rule, value, callback) => {
                      const dataSet = this.parseLine(
                        this.props.form.getFieldsValue().foreignDatasetText,
                      );

                      return _.isString(value) && this.isValidDataSet(dataSet)
                        ? callback()
                        : callback(`${Messages["dataset.import.invalid_fields"]}`);
                    },
                  },
                ],
              })(
                <TextArea
                  className="input-monospace"
                  placeholder="dataStoreName, url, dataSetName"
                  autoSize={{ minRows: 1 }}
                  style={{
                    fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
                  }}
                />,
              )}
            </FormItem>
            <FormItem>
              <Button size="large" type="primary" htmlType="submit" style={{ width: "100%" }}>
                Add Dataset
              </Button>
            </FormItem>
          </Form>
        </Card>
      </div>
    );
  }
}

export default Form.create()(DatasetAddForeignView);
