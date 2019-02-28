// @flow
import { Form, Input, Button, Col, Row } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import type { APIDataStore, APIUser } from "admin/api_flow_types";
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

const FormItem = Form.Item;

type OwnProps = {|
  datastores: Array<APIDataStore>,
  withoutCard?: boolean,
  onAdded: (string, string) => void,
|};
type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithForm = {|
  ...Props,
  form: Object,
|};

class DatasetAddWkConnectView extends React.PureComponent<PropsWithForm> {
  validateAndParseUrl(url: string) {
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
          "This dataset contains layers that are not supported by wk-connect. wk-connect supports only 'precomputed://' neuroglancer layers.",
        );
      }
    });
    return config;
  }

  handleSubmit = evt => {
    evt.preventDefault();
    const { activeUser } = this.props;

    this.props.form.validateFields(async (err, formValues) => {
      if (!err && activeUser != null) {
        const neuroglancerConfig = this.validateAndParseUrl(formValues.url);
        const fullLayers = _.keyBy(neuroglancerConfig.layers, "name");
        // Remove unnecessary attributes of the layer, the precomputed source prefix needs to be removed as well
        const layers = _.mapValues(fullLayers, ({ source, type }) => ({
          type,
          source: source.replace(/^(precomputed:\/\/)/, ""),
        }));

        const datasetConfig = {
          neuroglancer: {
            [activeUser.organization]: {
              [formValues.name]: {
                layers,
              },
            },
          },
        };

        await addWkConnectDataset(formValues.datastore, datasetConfig);

        Toast.success(messages["dataset.add_success"]);
        trackAction("Add remote dataset");
        await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
        this.props.onAdded(activeUser.organization, formValues.name);
      }
    });
  };

  render() {
    const { form, activeUser, withoutCard, datastores } = this.props;
    const { getFieldDecorator } = form;

    return (
      <div style={{ padding: 5 }}>
        <CardContainer withoutCard={withoutCard} title="Add wk-connect Dataset">
          Currently wk-connect supports adding Neuroglancer datasets. Simply set a dataset name,
          select the wk-connect datastore and paste the URL to the Neuroglancer dataset.
          <Form style={{ marginTop: 20 }} onSubmit={this.handleSubmit} layout="vertical">
            <Row gutter={8}>
              <Col span={12}>
                <DatasetNameFormItem form={form} activeUser={activeUser} />
              </Col>
              <Col span={12}>
                <DatastoreFormItem form={form} datastores={datastores} />
              </Col>
            </Row>
            <FormItem label="Dataset URL" hasFeedback>
              {getFieldDecorator("url", {
                rules: [
                  { required: true, message: messages["dataset.import.required.url"] },
                  {
                    validator: async (_rule, value, callback) => {
                      try {
                        this.validateAndParseUrl(value);
                        callback();
                      } catch (error) {
                        callback(error);
                      }
                    },
                  },
                ],
                validateFirst: true,
              })(<Input />)}
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
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(
  Form.create()(DatasetAddWkConnectView),
);
