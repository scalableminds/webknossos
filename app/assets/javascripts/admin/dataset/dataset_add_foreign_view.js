// @flow
import _ from "lodash";
import React from "react";
import { Form, Input, Button, Card, Upload, Icon, Spin, Progress, Divider } from "antd";
import { addDataSet } from "admin/admin_rest_api";
import Messages from "messages";
import Toast from "libs/toast";

import type { APITaskType } from "admin/api_flow_types";
import type { Vector3 } from "oxalis/constants";
import type { BoundingBoxObjectType } from "oxalis/store";
import {APIDataStoreType, APIUserType} from "../api_flow_types";
import {OxalisState} from "../../oxalis/store";
import {connect} from "react-redux";
import {withRouter} from "react-router-dom";

const FormItem = Form.Item;
const TextArea = Input.TextArea;

const NUM_TASKS_PER_BATCH = 100;

type StateProps = {
  activeUser: ?APIUserType,
};

type Props = StateProps & {
  form: Object,
  withoutCard?: boolean,
  onUploaded: string => void
};
type State = {
  datastores: Array<APIDataStoreType>,
  isUploading: boolean,
};

export type NewDataStoreType = {
  +dataStoreName: string,
  +url: string,
  +dataSetName: string,
};

class DatasetAddForeignView extends React.PureComponent<Props, State> {
  state = {
    datastores: [],
    isUploading: false,
  };

  isValidData(text): boolean { // TODO
    return true
  }

  isValidDataSet(dataStore: NewDataStoreType): boolean { // what would be a better name than dataStore
    if (
      !_.isString(dataStore.dataStoreName) ||
      !_.isString(dataStore.url) ||
      !_.isString(dataStore.dataSetName)
      // catch invalid dataSetName (regex) and invalid url
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

  parseLine(line: string): NewDataStoreType {
    const words = this.splitToWords(line);
    const dataStoreName = words[0];
    const url = words[1];
    const dataSetName = words[2];

    return {
      dataStoreName,
      url,
      dataSetName
    };
  }

handleSubmit = async e => {
  e.preventDefault();

  let dataSet;
  const formValues = this.props.form.getFieldsValue();
  console.log(formValues);
  dataSet = this.parseLine(formValues.foreignDatasetText);

  if (this.isValidDataSet(dataSet)) {
    console.log("valid dataset")
    await addDataSet(dataSet.dataStoreName, dataSet.url, dataSet.dataSetName);
    window.location.replace("/dashboard")
  } else {
    Toast.error(
      `${Messages["dataset.import.invalid_fields"]}`, // add to messages
    );
  }
};

render() {
  const { getFieldDecorator } = this.props.form;

  return (
    <div className="container" style={{ paddingTop: 20 }}>
      <Spin spinning={this.state.isUploading}>
        <Card title={<h3>Add Dataset</h3>}>
          <p>
            Specify the Dataset in the following format:
            <br />
            dataStoreName, url, dataSetName
          </p>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <FormItem label="Add foreign Dataset Specification" hasFeedback>
              {getFieldDecorator("foreignDatasetText", {
                rules: [
                  {
                    validator: (rule, value, callback) => {
                      const dataSet = this.parseLine(this.props.form.getFieldsValue().foreignDatasetText);

                      return _.isString(value) && this.isValidDataSet(dataSet)
                        ? callback()
                        : callback(
                          `${
                            Messages["dataset.import.invalid_fields"]
                            }`,
                        );
                    },
                  },
                ],
              })(
                <TextArea
                  className="input-monospace"
                  placeholder="dataStoreName, url, dataSetName"
                  autosize={{ minRows: 1 }}
                  style={{
                    fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
                  }}
                />,
              )}
            </FormItem>
            <FormItem>
              <Button type="primary" htmlType="submit">
                Add Dataset
              </Button>
            </FormItem>
          </Form>
        </Card>
      </Spin>
    </div>
  );
}
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(withRouter(Form.create()(DatasetAddForeignView)));
