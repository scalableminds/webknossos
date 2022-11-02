import { RouteComponentProps, withRouter } from "react-router-dom";
import { Form, Button, Card, Input, Row, FormInstance, Progress, Col, Alert } from "antd";
import {
  MailOutlined,
  TagOutlined,
  CopyOutlined,
  KeyOutlined,
  PlusCircleOutlined,
  SafetyOutlined,
  FieldTimeOutlined,
  SaveOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import React from "react";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { getOrganization, deleteOrganization, updateOrganization } from "admin/admin_rest_api";
import Toast from "libs/toast";
import { coalesce } from "libs/utils";

const FormItem = Form.Item;
export enum PricingPlanEnum {
  Basic = "Basic",
  Premium = "Premium",
  Pilot = "Pilot",
  Custom = "Custom",
}
export type PricingPlan = keyof typeof PricingPlanEnum;
type Props = {
  organizationName: string;
};
type State = {
  displayName: string;
  newUserMailingList: string;
  pricingPlan: PricingPlan | null | undefined;
  isFetchingData: boolean;
  isDeleting: boolean;
};

class OrganizationEditView extends React.PureComponent<Props, State> {
  state: State = {
    displayName: "",
    newUserMailingList: "",
    pricingPlan: null,
    isFetchingData: false,
    isDeleting: false,
  };
  formRef = React.createRef<FormInstance>();

  componentDidMount() {
    this.fetchData();
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (this.formRef.current != null) {
      // initialValues only works on the first render. Afterwards, values need to be updated
      // using setFieldsValue
      if (
        prevState.displayName.length === 0 &&
        this.state.displayName.length > 0 &&
        this.formRef.current.getFieldValue("displayName") !== this.state.displayName
      ) {
        this.formRef.current.setFieldsValue({
          displayName: this.state.displayName,
        });
      }

      if (
        prevState.newUserMailingList.length === 0 &&
        this.state.newUserMailingList.length > 0 &&
        this.formRef.current.getFieldValue("newUserMailingList") !== this.state.newUserMailingList
      ) {
        this.formRef.current.setFieldsValue({
          newUserMailingList: this.state.newUserMailingList,
        });
      }
    }
  }

  async fetchData() {
    this.setState({
      isFetchingData: true,
    });
    const { displayName, newUserMailingList, pricingPlan } = await getOrganization(
      this.props.organizationName,
    );
    this.setState({
      displayName,
      pricingPlan: coalesce(PricingPlanEnum, pricingPlan),
      newUserMailingList,
      isFetchingData: false,
    });
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  onFinish = async (formValues) => {
    await updateOrganization(
      this.props.organizationName,
      formValues.displayName,
      formValues.newUserMailingList,
    );
    window.location.replace(`${window.location.origin}/dashboard/`);
  };

  handleDeleteButtonClicked = async (): Promise<void> => {
    const isDeleteConfirmed = await confirmAsync({
      title: (
        <p>
          Deleting an organization cannot be undone. Are you certain you want to delete the
          organization {this.state.displayName}? <br />
          Attention: You will be logged out.
        </p>
      ),
      okText: "Yes, Delete Organization now",
    });

    if (isDeleteConfirmed) {
      this.setState({
        isDeleting: true,
      });
      await deleteOrganization(this.props.organizationName);
      this.setState({
        isDeleting: false,
      });
      window.location.replace(`${window.location.origin}/dashboard`);
    }
  };
  handleCopyNameButtonClicked = async (): Promise<void> => {
    await navigator.clipboard.writeText(this.props.organizationName);
    Toast.success("Organization name copied to clipboard");
  };

  render() {
    return (
      <div
        className="container"
        style={{
          paddingTop: 20,
          margin: "auto",
          maxWidth: 800,
        }}
      >
        <Row style={{ color: "#aaa", fontSize: "12" }}>Your Organization</Row>
        <Row style={{ marginBottom: 20 }}>
          <h2>{this.state.displayName}</h2>
        </Row>
        <Alert
          showIcon
          type="warning"
          message="You are using more XXX than included in your current plan. Upgrade now to avoid your account being blocked."
          action={
            <Button size="small" type="primary">
              Upgrade Now
            </Button>
          }
          style={{ marginBottom: 20 }}
        />
        <Row gutter={24} justify="space-between" align="stretch" style={{ marginBottom: 20 }}>
          <Col>
            <Card
              actions={[
                <span>
                  <PlusCircleOutlined /> Upgrade
                </span>,
              ]}
            >
              <Row style={{ padding: 20 }}>
                <Progress
                  type="dashboard"
                  percent={(4 / 5) * 100}
                  format={(_percent) => "4/5"}
                  success={{ strokeColor: "#ff4d4f" }}
                />
              </Row>
              <Row justify="center">Users</Row>
            </Card>
          </Col>
          <Col>
            <Card
              actions={[
                <span>
                  <PlusCircleOutlined /> Upgrade
                </span>,
              ]}
            >
              <Row style={{ padding: 20 }}>
                <Progress
                  type="dashboard"
                  percent={2.5}
                  format={(_percent) => `2.5/1TB`}
                  success={{ strokeColor: "#ff4d4f" }}
                />
              </Row>
              <Row justify="center">Storage</Row>
            </Card>
          </Col>
          <Col>
            <Card
              actions={[
                <a href="https://webknossos.org/pricing" target={"_blank"}>
                  <SafetyOutlined /> Compare Plans
                </a>,
              ]}
            >
              <Row justify="center" align="middle" style={{ minHeight: 160, padding: "25px 35px" }}>
                <h3>{this.state.pricingPlan}</h3>
              </Row>
              <Row justify="center">Current Plan</Row>
            </Card>
          </Col>
        </Row>
        <Card style={{ marginBottom: 20 }}>
          <Row gutter={24}>
            <Col flex="auto">Paid Until December 2022</Col>
            <Col span={6}>
              <Button type="primary" icon={<FieldTimeOutlined />}>
                Extend Now
              </Button>
            </Col>
          </Row>
        </Card>
        <Card
          title="Upgrade to Power Plan"
          style={{ marginBottom: 20 }}
          headStyle={{ backgroundColor: "rgb(245, 245, 245" }}
        >
          <Row gutter={24}>
            <Col flex="auto">
              <ul>
                <li>Advanced segmentation proof-reading tools</li>
                <li>Unlimited users</li>
                <li>Custom hosting solutions available</li>
              </ul>
            </Col>
            <Col span={6}>
              <Button type="primary" icon={<RocketOutlined />}>
                Upgrade Now
              </Button>
            </Col>
          </Row>
        </Card>
        <Card
          title="Settings"
          style={{ marginBottom: 20 }}
          headStyle={{ backgroundColor: "rgb(245, 245, 245" }}
        >
          <Form
            onFinish={this.onFinish}
            layout="vertical"
            ref={this.formRef}
            initialValues={{
              displayName: this.state.displayName,
              newUserMailingList: this.state.newUserMailingList,
            }}
          >
            <FormItem label="Organization ID">
              <Input.Group compact>
                <Input
                  prefix={<KeyOutlined />}
                  value={this.props.organizationName}
                  style={{
                    width: "calc(100% - 31px)",
                  }}
                  readOnly
                />
                <Button
                  onClick={this.handleCopyNameButtonClicked}
                  icon={<CopyOutlined className="without-icon-margin" />}
                />
              </Input.Group>
            </FormItem>
            <FormItem
              label="Organization Name"
              name="displayName"
              rules={[
                {
                  required: true,
                  // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'RegExp | ... Remove this comment to see the full error message
                  pattern: "^[A-Za-z0-9\\-_\\. ß]+$",
                  message:
                    "The organization name must not contain any special characters and can not be empty.",
                },
              ]}
            >
              <Input
                prefix={<TagOutlined />}
                autoFocus
                disabled={this.state.isFetchingData}
                placeholder="Display Name"
              />
            </FormItem>
            <FormItem
              label="Email Address for New-User Notifications"
              name="newUserMailingList"
              rules={[
                {
                  required: false,
                  type: "email",
                },
              ]}
            >
              <Input
                prefix={
                  <MailOutlined
                    style={{
                      fontSize: 13,
                    }}
                  />
                }
                disabled={this.state.isFetchingData}
                placeholder="mail@example.com"
              />
            </FormItem>
            <FormItem
              style={{
                marginRight: 20,
              }}
            >
              <Button
                type="primary"
                htmlType="submit"
                disabled={this.state.isFetchingData}
                icon={<SaveOutlined />}
              >
                Save
              </Button>
            </FormItem>
          </Form>
        </Card>

        <Card
          title="Danger Zone"
          style={{ marginBottom: 20 }}
          headStyle={{ backgroundColor: "rgb(245, 245, 245" }}
        >
          <Row>
            <Col span={18}>
              Delete this organization including all annotations, uploaded datasets, and associated
              user accounts. Careful, this action can NOT be undone.
            </Col>
            <Col span={6}>
              <Button
                danger
                loading={this.state.isDeleting}
                onClick={this.handleDeleteButtonClicked}
                disabled={this.state.isFetchingData}
              >
                Delete Organization
              </Button>
            </Col>
          </Row>
        </Card>
      </div>
    );
  }
}

export default withRouter<RouteComponentProps & Props, any>(OrganizationEditView);
