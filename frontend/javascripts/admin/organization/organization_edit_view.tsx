import React from "react";
import { connect } from "react-redux";
import { Form, Button, Card, Input, Row, FormInstance, Col, Skeleton } from "antd";
import {
  MailOutlined,
  TagOutlined,
  CopyOutlined,
  SaveOutlined,
  IdcardOutlined,
} from "@ant-design/icons";
import { confirmAsync } from "dashboard/dataset/helper_components";
import {
  deleteOrganization,
  updateOrganization,
  getUsers,
  getPricingPlanStatus,
} from "admin/admin_rest_api";
import Toast from "libs/toast";
import { APIOrganization, APIPricingPlanStatus } from "types/api_flow_types";
import {
  PlanAboutToExceedAlert,
  PlanDashboardCard,
  PlanExceededAlert,
  PlanExpirationCard,
  PlanUpgradeCard,
} from "./organization_cards";
import { enforceActiveOrganization } from "oxalis/model/accessors/organization_accessors";
import { getActiveUserCount } from "./pricing_plan_utils";
import type { OxalisState } from "oxalis/store";

const FormItem = Form.Item;
export enum PricingPlanEnum {
  Basic = "Basic",
  Team = "Team",
  Power = "Power",
  TeamTrial = "Team_Trial",
  PowerTrial = "Power_Trial",
  Custom = "Custom",
}

type Props = {
  organization: APIOrganization;
};

type State = {
  isFetchingData: boolean;
  isDeleting: boolean;
  activeUsersCount: number;
  pricingPlanStatus: APIPricingPlanStatus | null;
};

class OrganizationEditView extends React.PureComponent<Props, State> {
  state: State = {
    isFetchingData: false,
    isDeleting: false,
    activeUsersCount: 1,
    pricingPlanStatus: null,
  };

  formRef = React.createRef<FormInstance>();

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    this.setState({
      isFetchingData: true,
    });
    const [users, pricingPlanStatus] = await Promise.all([getUsers(), getPricingPlanStatus()]);

    this.setState({
      isFetchingData: false,
      pricingPlanStatus,
      activeUsersCount: getActiveUserCount(users),
    });
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  onFinish = async (formValues) => {
    await updateOrganization(
      this.props.organization.name,
      formValues.displayName,
      formValues.newUserMailingList,
    );
    Toast.success("Organization settings were saved successfully.");
  };

  handleDeleteButtonClicked = async (): Promise<void> => {
    const isDeleteConfirmed = await confirmAsync({
      title: (
        <p>
          Deleting an organization cannot be undone. Are you certain you want to delete the
          organization {this.props.organization.displayName}? <br />
          Attention: You will be logged out.
        </p>
      ),
      okText: "Yes, delete this organization now.",
    });

    if (isDeleteConfirmed) {
      this.setState({
        isDeleting: true,
      });
      await deleteOrganization(this.props.organization.name);
      this.setState({
        isDeleting: false,
      });
      window.location.replace(`${window.location.origin}/dashboard`);
    }
  };

  handleCopyNameButtonClicked = async (): Promise<void> => {
    await navigator.clipboard.writeText(this.props.organization.name);
    Toast.success("Copied organization name to the clipboard.");
  };

  render() {
    if (this.state.isFetchingData || !this.props.organization || !this.state.pricingPlanStatus)
      return (
        <div
          className="container"
          style={{
            paddingTop: 40,
            margin: "auto",
            maxWidth: 800,
          }}
        >
          <Skeleton active />
        </div>
      );

    const OrgaNameRegexPattern = /^[A-Za-z0-9\\-_\\. ß]+$/;

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
          <h2>{this.props.organization.displayName}</h2>
        </Row>
        {this.state.pricingPlanStatus.isExceeded ? (
          <PlanExceededAlert organization={this.props.organization} />
        ) : null}
        {this.state.pricingPlanStatus.isAlmostExceeded &&
        !this.state.pricingPlanStatus.isExceeded ? (
          <PlanAboutToExceedAlert organization={this.props.organization} />
        ) : null}
        <PlanDashboardCard
          organization={this.props.organization}
          activeUsersCount={this.state.activeUsersCount}
        />
        <PlanExpirationCard organization={this.props.organization} />
        <PlanUpgradeCard organization={this.props.organization} />
        <Card title="Settings" style={{ marginBottom: 20 }}>
          <Form
            onFinish={this.onFinish}
            layout="vertical"
            ref={this.formRef}
            initialValues={{
              displayName: this.props.organization.displayName,
              newUserMailingList: this.props.organization.newUserMailingList,
            }}
          >
            <FormItem label="Organization ID">
              <Input.Group compact>
                <Input
                  prefix={<IdcardOutlined />}
                  value={this.props.organization.name}
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
                  pattern: OrgaNameRegexPattern,
                  message:
                    "Organization names must not contain any special characters and can not be empty.",
                },
              ]}
            >
              <Input
                prefix={<TagOutlined />}
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
                  message: "Please provide a valid email address.",
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
            <Button
              type="primary"
              htmlType="submit"
              disabled={this.state.isFetchingData}
              icon={<SaveOutlined />}
            >
              Save
            </Button>
          </Form>
        </Card>
        <Card title="Danger Zone" style={{ marginBottom: 20 }}>
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

const mapStateToProps = (state: OxalisState): Props => ({
  organization: enforceActiveOrganization(state.activeOrganization),
});

const connector = connect(mapStateToProps);
export default connector(OrganizationEditView);
