import { Form, Input, Button, Card } from "antd";
import React from "react";
import _ from "lodash";
import { addForeignDataSet } from "admin/admin_rest_api";
import Messages from "messages";
import Toast from "libs/toast";
const FormItem = Form.Item;
const { TextArea } = Input;
type Props = {
  onAdded: () => void;
};
export type ForeignDataSetSpecification = {
  readonly dataStoreName: string;
  readonly url: string;
  readonly dataSetName: string;
};

function DatasetAddForeignView({ onAdded }: Props) {
  const [form] = Form.useForm();

  function isValidDataSet(specification: ForeignDataSetSpecification): boolean {
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

  function splitToWords(string: string): Array<string> {
    return string
      .split(",")
      .map((word) => word.trim())
      .filter((word) => word !== "");
  }

  function parseLine(specification: string): ForeignDataSetSpecification {
    const words = splitToWords(specification);
    const dataStoreName = words[0];
    const url = words[1];
    const dataSetName = words[2];
    return {
      dataStoreName,
      url,
      dataSetName,
    };
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  const handleSubmit = async (formValues) => {
    const specification = parseLine(formValues.foreignDatasetText);

    if (isValidDataSet(specification)) {
      await addForeignDataSet(
        specification.dataStoreName,
        specification.url,
        specification.dataSetName,
      );
      onAdded();
    } else {
      Toast.error(`${Messages["dataset.import.invalid_fields"]}`);
    }
  };

  return (
    <div
      className="container"
      style={{
        paddingTop: 20,
      }}
    >
      <Card title={<h3>Add Dataset</h3>} bordered={false}>
        <p>
          Specify the Dataset in the following format:
          <br />
          dataStoreName, url, dataSetName
        </p>
        <Form onFinish={handleSubmit} layout="vertical" form={form}>
          <FormItem
            name="foreignDatasetText"
            label="Add Foreign Dataset Specification"
            hasFeedback
            rules={[
              {
                validator: (rule, value) => {
                  const dataSet = parseLine(form.getFieldsValue().foreignDatasetText);
                  return _.isString(value) && isValidDataSet(dataSet)
                    ? Promise.resolve()
                    : Promise.reject(new Error(`${Messages["dataset.import.invalid_fields"]}`));
                },
              },
            ]}
          >
            <TextArea
              className="input-monospace"
              placeholder="dataStoreName, url, dataSetName"
              autoSize={{
                minRows: 1,
              }}
              style={{
                fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
              }}
            />
          </FormItem>
          <FormItem>
            <Button
              size="large"
              type="primary"
              htmlType="submit"
              style={{
                width: "100%",
              }}
            >
              Add Dataset
            </Button>
          </FormItem>
        </Form>
      </Card>
    </div>
  );
}

export default DatasetAddForeignView;
