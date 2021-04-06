// @flow
import { Form, Input, Button, Col, Row, Upload } from "antd";
import { UnlockOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import React, { useState } from "react";
import _ from "lodash";

import type { APIDataStore, APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { addWkConnectDataset } from "admin/admin_rest_api";
import messages from "messages";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { trackAction } from "oxalis/model/helpers/analytics";
import {
  CardContainer,
  DatasetNameFormItem,
  DatastoreFormItem,
} from "admin/dataset/dataset_components";
import { readFileAsText } from "libs/read_file";

const FormItem = Form.Item;

type OwnProps = {|
  datastores: Array<APIDataStore>,
  onAdded: (string, string) => Promise<void>,
|};
type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};

type FileList = Array<{ originFileObj: File }>;

function DatasetAddNeuroglancerView({ datastores, onAdded, activeUser }: Props) {
  const [fileList, setFileList] = useState<FileList>([]);
  const [form] = Form.useForm();

  function validateAndParseUrl(url: string) {
    const delimiterIndex = url.indexOf("#!");
    if (delimiterIndex < 0) {
      throw new Error("The URL doesn't contain the #! delimiter. Please insert the full URL.");
    }

    const jsonConfig = url.slice(delimiterIndex + 2);
    // This will throw an error if the URL did not contain valid JSON. The error will be handled by the caller.
    const config = JSON.parse(decodeURIComponent(jsonConfig));
    config.layers.forEach(layer => {
      if (!layer.source.startsWith("precomputed://")) {
        throw new Error(
          "This dataset contains layers that are not supported. wk-connect supports only 'precomputed://' neuroglancer layers.",
        );
      }
    });
    return config;
  }

  const handleChange = info => {
    // Restrict the upload list to the latest file
    const newFileList = info.fileList.slice(-1);
    setFileList(newFileList);
  };

  const parseCredentials = async (file: File) => {
    const jsonString = await readFileAsText(file);
    return JSON.parse(jsonString);
  };

  async function handleSubmit(formValues) {
    if (activeUser == null) return;

    const neuroglancerConfig = validateAndParseUrl(formValues.url);
    const fullLayers = _.keyBy(neuroglancerConfig.layers, "name");
    // Remove unnecessary attributes of the layer, the precomputed source prefix needs to be removed as well
    const layers = _.mapValues(fullLayers, ({ source, type }) => ({
      type,
      source: source.replace(/^(precomputed:\/\/)/, ""),
    }));
    const credentials =
      fileList.length > 0 ? await parseCredentials(fileList[0].originFileObj) : null;

    const datasetConfig = {
      neuroglancer: {
        [activeUser.organization]: {
          [formValues.name]: {
            layers,
            ...(credentials != null ? { credentials } : {}),
          },
        },
      },
    };

    trackAction("Add Neuroglancer dataset");
    await addWkConnectDataset(formValues.datastore, datasetConfig);

    Toast.success(messages["dataset.add_success"]);
    await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
    onAdded(activeUser.organization, formValues.name);
  }

  return (
    <div style={{ padding: 5 }}>
      <CardContainer title="Add Neuroglancer Dataset">
        Currently we only support Neuroglancer precomputed datasets. Simply set a dataset name,
        select the wk-connect datastore and paste the URL to the Neuroglancer dataset. Optionally, a
        credentials file to a Google Cloud Storage instance can be supplied.
        <Form style={{ marginTop: 20 }} onFinish={handleSubmit} layout="vertical" form={form}>
          <Row gutter={8}>
            <Col span={12}>
              <DatasetNameFormItem activeUser={activeUser} />
            </Col>
            <Col span={12}>
              <DatastoreFormItem datastores={datastores} />
            </Col>
          </Row>
          <FormItem
            name="url"
            label="Dataset URL"
            hasFeedback
            rules={[
              { required: true, message: messages["dataset.import.required.url"] },
              {
                validator: async (_rule, value) => {
                  try {
                    validateAndParseUrl(value);
                    Promise.resolve();
                  } catch (error) {
                    Promise.reject(error);
                  }
                },
              },
            ]}
            validateFirst
          >
            <Input />
          </FormItem>
          <FormItem
            name="authFile"
            label={
              <React.Fragment>
                Google{" "}
                <a
                  href="https://cloud.google.com/iam/docs/creating-managing-service-account-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Service Account
                </a>{" "}
                Key (Optional)
              </React.Fragment>
            }
            hasFeedback
          >
            <Upload.Dragger
              name="files"
              fileList={fileList}
              onChange={handleChange}
              beforeUpload={() => false}
            >
              <p className="ant-upload-drag-icon">
                <UnlockOutlined style={{ margin: 0, fontSize: 35 }} />
              </p>
              <p className="ant-upload-text">
                Click or Drag your Google Cloud Authentication File to this Area to Upload
              </p>
              <p className="ant-upload-text-hint">
                This is only needed if the dataset is located in a non-public Google Cloud Storage
                bucket
              </p>
            </Upload.Dragger>
          </FormItem>
          <FormItem style={{ marginBottom: 0 }}>
            <Button size="large" type="primary" htmlType="submit" style={{ width: "100%" }}>
              Add
            </Button>
          </FormItem>
        </Form>
      </CardContainer>
    </div>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(DatasetAddNeuroglancerView);
