// @flow
import { Form, Input, Button, Col, Row } from "antd";
import { connect } from "react-redux";
import React from "react";
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

const FormItem = Form.Item;
const { Password } = Input;

const Slash = () => (
  <Col span={1} style={{ textAlign: "center" }}>
    <div style={{ marginTop: 35 }}>/</div>
  </Col>
);

type OwnProps = {|
  datastores: Array<APIDataStore>,
  onAdded: (string, string) => Promise<void>,
|};
type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};

function DatasetAddBossView(props: Props) {
  const [form] = Form.useForm();

  const handleSubmit = async formValues => {
    const { activeUser } = props;
    if (activeUser == null) return;

    const { name, domain, collection, experiment, username, password } = formValues;
    const httpsDomain = domain.startsWith("bossdb://")
      ? domain.replace(/^bossdb/, "https")
      : domain;
    const datasetConfig = {
      boss: {
        [activeUser.organization]: {
          [name]: {
            domain: httpsDomain,
            collection,
            experiment,
            username,
            password,
          },
        },
      },
    };

    trackAction("Add BossDB dataset");
    await addWkConnectDataset(formValues.datastore, datasetConfig);

    Toast.success(messages["dataset.add_success"]);
    await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
    props.onAdded(activeUser.organization, formValues.name);
  };

  const { activeUser, datastores } = props;

  return (
    <div
      style={{
        padding: 5,
      }}
    >
      <CardContainer title="Add BossDB Dataset">
        <Form
          style={{
            marginTop: 20,
          }}
          onFinish={handleSubmit}
          layout="vertical"
          form={form}
        >
          <Row gutter={8}>
            <Col span={12}>
              <DatasetNameFormItem form={form} activeUser={activeUser} />
            </Col>
            <Col span={12}>
              <DatastoreFormItem form={form} datastores={datastores} />
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={12}>
              <FormItem
                name="domain"
                label="Domain"
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                ]}
                validateFirst
              >
                <Input />
              </FormItem>
            </Col>
            <Slash />
            <Col span={5}>
              <FormItem
                name="collect"
                label="Collection"
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                ]}
                validateFirst:true
              >
                <Input />
              </FormItem>
            </Col>
            <Slash />
            <Col span={5}>
              <FormItem
                name="experiment"
                label="Experiment"
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                ]}
                validateFirst
              >
                <Input />
              </FormItem>
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={12}>
              <FormItem
                name="username"
                label="Username"
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                ]}
                validateFirst
              >
                <Input />
              </FormItem>
            </Col>
            <Col span={12}>
              <FormItem
                name="password"
                label="Password"
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                ]}
                validateFirst
              >
                <Password />
              </FormItem>
            </Col>
          </Row>
          <FormItem
            style={{
              marginBottom: 0,
            }}
          >
            <Button
              size="large"
              type="primary"
              htmlType="submit"
              style={{
                width: "100%",
              }}
            >
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

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(DatasetAddBossView);
