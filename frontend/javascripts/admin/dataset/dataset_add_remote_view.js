// @flow
import { Form, Input, Select, Button, Card, Col, Row } from "antd";
import { connect } from "react-redux";
import React from "react";

import type { APIDataStore, APIUser } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { getDatastores, isDatasetNameValid } from "admin/admin_rest_api";
import messages from "messages";
import { trackAction } from "oxalis/model/helpers/analytics";

const FormItem = Form.Item;
const { Option } = Select;

type OwnProps = {|
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

type State = {
  datastores: Array<APIDataStore>,
};

class DatasetAddRemoteView extends React.PureComponent<PropsWithForm, State> {
  state = {
    datastores: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const datastores = await getDatastores();

    this.setState({
      datastores,
    });

    if (datastores.length > 0) {
      this.props.form.setFieldsValue({ datastore: datastores[0].url });
    }
  }

  validateUrl(url: string) {
    const delimiterIndex = url.indexOf("#!");
    if (delimiterIndex < 0) {
      return "The URL doesn't contain the #! delimiter. Please insert the full URL.";
    }

    const jsonConfig = url.slice(delimiterIndex + 2);
    try {
      const config = JSON.parse(decodeURIComponent(jsonConfig));
      console.log(config.layers);
      return null;
    } catch (error) {
      return error;
    }
  }

  handleSubmit() {
    console.log("Submit");
    trackAction("Added remote dataset");
  }

  render() {
    const { getFieldDecorator } = this.props.form;

    const Container = ({ children }) => {
      if (this.props.withoutCard) {
        return <React.Fragment>{children}</React.Fragment>;
      } else {
        return (
          <Card
            style={{ width: "85%", marginLeft: "auto", marginRight: "auto" }}
            bordered={false}
            title={<h3>Add Remote Dataset</h3>}
          >
            {children}
          </Card>
        );
      }
    };
    return (
      <div style={{ padding: 5 }}>
        <Container>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <Row gutter={8}>
              <Col span={12}>
                <FormItem label="Dataset Name" hasFeedback>
                  {getFieldDecorator("name", {
                    rules: [
                      { required: true, message: messages["dataset.import.required.name"] },
                      { min: 3 },
                      { pattern: /[0-9a-zA-Z_-]+$/ },
                      {
                        validator: async (_rule, value, callback) => {
                          if (!this.props.activeUser)
                            throw new Error("Can't do operation if no user is logged in.");
                          const reasons = await isDatasetNameValid({
                            name: value,
                            owningOrganization: this.props.activeUser.organization,
                          });
                          if (reasons != null) {
                            callback(reasons);
                          } else {
                            callback();
                          }
                        },
                      },
                    ],
                    validateFirst: true,
                  })(<Input autoFocus />)}
                </FormItem>
              </Col>
              <Col span={12}>
                <FormItem label="Datastore" hasFeedback>
                  {getFieldDecorator("datastore", {
                    rules: [
                      { required: true, message: messages["dataset.import.required.datastore"] },
                    ],
                  })(
                    <Select
                      showSearch
                      placeholder="Select a Datastore"
                      optionFilterProp="children"
                      style={{ width: "100%" }}
                    >
                      {this.state.datastores.map((datastore: APIDataStore) => (
                        <Option key={datastore.name} value={datastore.url}>
                          {`${datastore.name}`}
                        </Option>
                      ))}
                    </Select>,
                  )}
                </FormItem>
              </Col>
            </Row>
            <FormItem label="Dataset URL" hasFeedback>
              {getFieldDecorator("url", {
                rules: [
                  { required: true, message: messages["dataset.import.required.name"] },
                  { min: 3 },
                  { pattern: /[0-9a-zA-Z_-]+$/ },
                  {
                    validator: async (_rule, value, callback) => {
                      const reasons = this.validateUrl(value);
                      if (reasons != null) {
                        callback(reasons);
                      } else {
                        callback();
                      }
                    },
                  },
                ],
                validateFirst: true,
              })(<Input autoFocus />)}
            </FormItem>
            <FormItem style={{ marginBottom: 0 }}>
              <Button size="large" type="primary" htmlType="submit" style={{ width: "100%" }}>
                Upload
              </Button>
            </FormItem>
          </Form>
        </Container>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(
  Form.create()(DatasetAddRemoteView),
);
