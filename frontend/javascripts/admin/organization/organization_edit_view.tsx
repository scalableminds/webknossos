import { RouteComponentProps, withRouter } from "react-router-dom";
import { Form, Button, Card, Input, Row, FormInstance, Col, Skeleton } from "antd";
import {
  MailOutlined,
  TagOutlined,
  CopyOutlined,
  KeyOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import React from "react";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { getOrganization, deleteOrganization, updateOrganization, getUsers } from "admin/admin_rest_api";
import Toast from "libs/toast";
import { coalesce } from "libs/utils";
import { APIOrganization } from "types/api_flow_types";
import { PlanDashboardCard, PlanExpirationCard, PlanUpgradeCard } from "./organization_cards";

const FormItem = Form.Item;
export enum PricingPlanEnum {
  Free = "Free",
  Team = "Team",
  Power = "Power",
  TeamTrial = "Team_Trial",
  PowerTrial = "Power_Trial",
  Custom = "Custom",
}
type Props = {
  organizationName: string;
};
type State = {
  displayName: string;
  newUserMailingList: string;
  pricingPlan: PricingPlanEnum | null | undefined;
  isFetchingData: boolean;
  isDeleting: boolean;
  organization: APIOrganization | null;
  activeUsersCount: number
};

class OrganizationEditView extends React.PureComponent<Props, State> {
  state: State = {
    displayName: "",
    newUserMailingList: "",
    pricingPlan: null,
    isFetchingData: false,
    isDeleting: false,
    organization: null,
    activeUsersCount: 1,
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
    const [organization, users] = await Promise.all([
      getOrganization(this.props.organizationName),
      getUsers(),
    ]);
    const { displayName, newUserMailingList, pricingPlan } = organization;
    this.setState({
      displayName,
      pricingPlan: coalesce(PricingPlanEnum, pricingPlan),
      newUserMailingList,
      isFetchingData: false,
      organization,
      activeUsersCount: users.filter(u => u.isActive && !u.isSuperUser).length,
    });
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  onFinish = async (formValues) => {
    await updateOrganization(
      this.props.organizationName,
      formValues.displayName,
      formValues.newUserMailingList,
    );
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
      okText: "Yes, delete this organization now.",
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
    if (this.state.isFetchingData || !this.state.organization || !this.state.pricingPlan)
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
          <h2>{this.state.displayName}</h2>
        </Row>
        <PlanDashboardCard
          organization={this.state.organization}
          activeUsersCount={this.state.activeUsersCount}
        />
        <PlanExpirationCard organization={this.state.organization} />
        <PlanUpgradeCard organization={this.state.organization} />
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
