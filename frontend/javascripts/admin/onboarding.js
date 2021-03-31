// @flow
import { Form, Modal, Input, Button, Row, Col, Steps, Card, AutoComplete } from "antd";
import {
  CloudUploadOutlined,
  TeamOutlined,
  UserOutlined,
  FileAddOutlined,
  RocketOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  PaperClipOutlined,
  CodeOutlined,
  CustomerServiceOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { type RouterHistory, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import React, { type Node } from "react";

import type { APIUser, APIDataStore } from "types/api_flow_types";
import Store, { type OxalisState } from "oxalis/store";
import { getDatastores, sendInvitesForOrganization } from "admin/admin_rest_api";
import DatasetImportView from "dashboard/dataset/dataset_import_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import RegistrationForm from "admin/auth/registration_form";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";
import Toast from "libs/toast";
import features from "features";
import renderIndependently from "libs/render_independently";

const { Step } = Steps;
const FormItem = Form.Item;

type StateProps = {|
  activeUser: ?APIUser,
|};

type Props = { ...StateProps, history: RouterHistory };

type State = {
  currentStep: number,
  datastores: Array<APIDataStore>,
  organizationName: string,
  datasetNameToImport: ?string,
  isDatasetUploadModalVisible: boolean,
  isInviteModalVisible: boolean,
};

function StepHeader({
  header,
  subheader,
  icon,
  children,
}: {
  header: string,
  subheader: Node,
  icon: Node,
  children: Node,
}) {
  return (
    <div>
      <div style={{ paddingBottom: 32, textAlign: "center" }}>
        {icon}
        <p style={{ fontSize: 24, margin: "14px 0 0" }}>{header}</p>
        <p
          style={{
            fontSize: 14,
            margin: "14px 0",
            color: "gray",
            display: "inline-block",
            width: 500,
          }}
        >
          {subheader}
        </p>
      </div>
      {children}
    </div>
  );
}

function FeatureCard({ icon, header, children }) {
  const columnSpan = { xs: 24, sm: 24, md: 12, lg: 12, xl: 8, xxl: 8 };

  return (
    <Col {...columnSpan} style={{ padding: 12 }}>
      <Card style={{ textAlign: "center", height: "100%" }}>
        <div style={{ fontSize: 30 }}>{icon}</div>
        <p style={{ fontWeight: "bold" }}>{header}</p>
        <p style={{ color: "gray" }}>{children}</p>
      </Card>
    </Col>
  );
}

type OptionCardProps = {
  icon: Node,
  header: string,
  children: Node,
  action: Node,
  height: number,
};

export function OptionCard({ icon, header, children, action, height }: OptionCardProps) {
  return (
    <div style={{ padding: 12 }}>
      <Card
        bordered={false}
        bodyStyle={{
          textAlign: "center",
          height,
          width: 350,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-around",
          boxShadow: "0px 0px 4px rgba(0, 0, 0, 0.25)",
          borderRadius: 3,
          border: 0,
        }}
      >
        <div
          className="withoutIconMargin"
          style={{
            fontSize: 32,
            background: "#1790ff",
            borderRadius: "30px",
            padding: "6px 14px",
            color: "white",
            textAlign: "center",
            display: "inline-block",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {icon}
        </div>
        <h1
          style={{
            fontSize: 20,
            lineHeight: "22px",
            color: "#0d232d",
            marginBottom: 0,
          }}
        >
          {header}
        </h1>
        <p style={{ fontSize: 14, lineHeight: "18px", color: "#6b7280", margin: 0 }}>{children}</p>
        <p>{action}</p>
      </Card>
    </div>
  );
}

export class InviteUsersModal extends React.Component<
  {
    visible?: boolean,
    handleVisibleChange?: Function,
    destroy?: Function,
  },
  { inviteesString: string },
> {
  state = {
    inviteesString: "",
  };

  sendInvite = async () => {
    const addresses = this.state.inviteesString.split(/[,\s]+/);
    const incorrectAddresses = addresses.filter(address => !address.includes("@"));

    if (incorrectAddresses.length > 0) {
      Toast.error(
        `Couldn't recognize this email address: ${incorrectAddresses[0]}. No emails were sent.`,
      );
      return;
    }

    await sendInvitesForOrganization(addresses, true);
    Toast.success("An invitation was sent to the provided email addresses.");
    this.setState({ inviteesString: "" });
    if (this.props.handleVisibleChange != null) this.props.handleVisibleChange(false);
    if (this.props.destroy != null) this.props.destroy();
  };

  getContent() {
    return (
      <React.Fragment>
        Send invites to the following email addresses. Multiple addresses should be separated with a
        comma, a space or a new line:
        <Input.TextArea
          spellCheck={false}
          autoSize={{ minRows: 6 }}
          onChange={evt => {
            this.setState({ inviteesString: evt.target.value });
          }}
          placeholder={"jane@example.com\njoe@example.com"}
          value={this.state.inviteesString}
        />
      </React.Fragment>
    );
  }

  render() {
    return (
      <Modal
        visible={this.props.visible == null ? true : this.props.visible}
        title="Invite Users"
        width={600}
        footer={
          <Button onClick={this.sendInvite} type="primary">
            Send Invites
          </Button>
        }
        onCancel={() => {
          if (this.props.handleVisibleChange != null) this.props.handleVisibleChange(false);
          if (this.props.destroy != null) this.props.destroy();
        }}
      >
        {this.getContent()}
      </Modal>
    );
  }
}

const OrganizationForm = ({ onComplete }) => {
  const [form] = Form.useForm();
  // TODO: check whether this how you check for errors correctly.
  const hasErrors = (_, fieldErrors) => fieldErrors.length > 0;
  const onFinish = values => {
    onComplete(values.organizationName);
  };
  const { getFieldsError, getFieldError, isFieldTouched } = form;

  const organizationNameError =
    isFieldTouched("organizationName") && getFieldError("organizationName");

  return (
    <Form onFinish={onFinish} form={form} initialValues={{ organizationName: "" }}>
      <Row type="flex" justify="center" style={{ padding: "20px 50px" }} align="middle" gutter={8}>
        <Col span={18}>
          <FormItem
            validateStatus={organizationNameError ? "error" : ""}
            help={organizationNameError || ""}
            style={{ width: "100%" }}
            rules={[{ required: true, message: "Please enter an organization name!" }]}
            name="organizationName"
          >
            <AutoComplete
              size="large"
              options={[]}
              defaultActiveFirstOption={false}
              placeholder="Your organization name"
            />
          </FormItem>
        </Col>
        <Col span={6}>
          <FormItem>
            <Button
              size="large"
              type="primary"
              icon={<PlusOutlined />}
              style={{ width: "100%" }}
              htmlType="submit"
              disabled={hasErrors(getFieldsError())}
            >
              Create
            </Button>
          </FormItem>
        </Col>
      </Row>
    </Form>
  );
};

class OnboardingView extends React.PureComponent<Props, State> {
  state = {
    currentStep: 0,
    datastores: [],
    organizationName: "",
    isDatasetUploadModalVisible: false,
    isInviteModalVisible: false,
    datasetNameToImport: null,
  };

  componentDidMount() {
    if (this.props.activeUser != null) {
      this.props.history.push("/dashboard");
    }
  }

  async fetchDatastores() {
    const datastores = (await getDatastores()).filter(ds => !ds.isForeign && !ds.isConnector);
    this.setState({ datastores });
  }

  advanceStep = () => {
    this.setState(prevState => ({
      currentStep: prevState.currentStep + 1,
      isDatasetUploadModalVisible: false,
      isInviteModalVisible: false,
      datasetNameToImport: null,
    }));
  };

  renderSampleDatasetsModal = () => {
    renderIndependently(destroy => (
      <SampleDatasetsModal
        organizationName={this.state.organizationName}
        destroy={destroy}
        onOk={this.advanceStep}
      />
    ));
  };

  renderCreateOrganization = () => (
    <StepHeader
      header="Create or Join an Organization"
      subheader={
        <React.Fragment>
          Welcome to webKnossos! This guide will help you get started.
          <br />
          Setup your organization to manage users and datasets. Example names: &ldquo;University of
          Springfield&rdquo;, &ldquo;Simpsons Lab&rdquo;, &ldquo;Neuroscience Department&rdquo;
        </React.Fragment>
      }
      icon={<i className="far fa-building icon-big" />}
    >
      <OrganizationForm
        onComplete={organizationName => {
          this.setState({ organizationName });
          this.advanceStep();
        }}
      />
    </StepHeader>
  );

  renderCreateAccount = () => (
    <StepHeader
      header="Create an Admin Account"
      subheader={
        <React.Fragment>
          This will be the first user account in your organization. It will be equipped with admin
          privileges in order to confirm user registrations, define teams, create tasks and much
          more.
        </React.Fragment>
      }
      icon={<UserOutlined className="icon-big" />}
    >
      <RegistrationForm
        hidePrivacyStatement
        organizationNameToCreate={this.state.organizationName}
        onRegistered={() => {
          // Update the entered organization to the normalized name of the organization received by the backend.
          // This is needed for further requests.
          const { activeUser } = Store.getState();
          if (activeUser) {
            this.setState({ organizationName: activeUser.organization });
            // A user can only see the available datastores when he is logged in.
            // Thus we can fetch the datastores only after the registration.
            this.fetchDatastores();
          }
          this.advanceStep();
        }}
        confirmLabel="Create account"
        tryAutoLogin
      />
    </StepHeader>
  );

  renderUploadDatasets = () => (
    <StepHeader
      header="Add the first dataset to your organization."
      subheader={
        <React.Fragment>
          Upload your dataset via drag and drop or add one of our sample datasets.
        </React.Fragment>
      }
      icon={<FileAddOutlined className="icon-big" />}
    >
      {this.state.isDatasetUploadModalVisible && (
        <Modal
          visible
          width="85%"
          footer={null}
          maskClosable={false}
          onCancel={() => this.setState({ isDatasetUploadModalVisible: false })}
        >
          <DatasetUploadView
            datastores={this.state.datastores}
            onUploaded={async (
              _organization: string,
              datasetName: string,
              needsConversion: boolean,
            ) => {
              this.setState({
                datasetNameToImport: datasetName,
                isDatasetUploadModalVisible: false,
              });
              if (needsConversion) {
                // If the dataset needs a conversion, the settings cannot be shown. Thus we skip the settings step.
                this.advanceStep();
              }
            }}
            withoutCard
          />
        </Modal>
      )}
      {this.state.datasetNameToImport != null && (
        <Modal visible width="85%" footer={null} maskClosable={false} onCancel={this.advanceStep}>
          <DatasetImportView
            isEditingMode={false}
            datasetId={{
              name: this.state.datasetNameToImport || "",
              owningOrganization: this.state.organizationName || "",
            }}
            onComplete={this.advanceStep}
            onCancel={this.advanceStep}
          />
        </Modal>
      )}
      <Row type="flex" gutter={16} justify="center" align="bottom">
        <OptionCard
          header="Upload Dataset"
          icon={<CloudUploadOutlined />}
          action={
            <Button onClick={() => this.setState({ isDatasetUploadModalVisible: true })}>
              Upload your dataset
            </Button>
          }
          height={250}
        >
          You can also copy it directly onto the hosting server.{" "}
          <a href="https://docs.webknossos.org/reference/data_formats">
            Learn more about supported data formats.
          </a>
        </OptionCard>
        <OptionCard
          header="Add Sample Dataset"
          icon={<RocketOutlined />}
          action={
            <Button type="primary" onClick={this.renderSampleDatasetsModal}>
              Add Sample Dataset
            </Button>
          }
          height={350}
        >
          This is the easiest way to try out webKnossos. Add one of our sample datasets and start
          exploring in less than a minute.
        </OptionCard>
        <OptionCard
          header="Skip"
          icon={<ClockCircleOutlined />}
          action={
            <a href="#" onClick={this.advanceStep}>
              Skip this step
            </a>
          }
          height={170}
        >
          You can always do this later!
        </OptionCard>
      </Row>
    </StepHeader>
  );

  renderWhatsNext = () => (
    <StepHeader
      header="Congratulations!"
      subheader={
        <React.Fragment>
          You&apos;ve completed the initial setup.
          <br />
          <a href="/dashboard">Start to explore and annotate your data now</a> or learn more about
          the features and concepts of webKnossos.
        </React.Fragment>
      }
      icon={<RocketOutlined className="icon-big" />}
    >
      <Row type="flex" gutter={50}>
        <FeatureCard header="Data Annotation" icon={<PlayCircleOutlined />}>
          <a href="/dashboard">Explore and annotate your data.</a> For a brief overview,{" "}
          <a href="https://www.youtube.com/watch?v=jsz0tc3tuKI&t=30s">watch this video</a>.
        </FeatureCard>
        <FeatureCard header="More Datasets" icon={<CloudUploadOutlined />}>
          <a href="/datasets/upload">Upload more of your datasets.</a>{" "}
          <a href="https://docs.webknossos.org/reference/data_formats">Learn more</a> about the
          formats and upload processes webKnossos supports.
        </FeatureCard>
        <FeatureCard header="User & Team Management" icon={<TeamOutlined />}>
          <a onClick={() => this.setState({ isInviteModalVisible: true })} href="#">
            Invite users
          </a>{" "}
          <InviteUsersModal
            visible={this.state.isInviteModalVisible}
            handleVisibleChange={isInviteModalVisible => this.setState({ isInviteModalVisible })}
          />
          and assign them to <a href="/teams">teams</a>. Teams can be used to define dataset
          permissions and task assignments.
        </FeatureCard>
        <FeatureCard header="Project Management" icon={<PaperClipOutlined />}>
          Create <a href="/tasks">tasks</a> and <a href="/projects">projects</a> to efficiently
          accomplish your research goals.{" "}
          <a href="https://www.youtube.com/watch?v=4DD7408avUY">Watch this demo</a> to learn more.
        </FeatureCard>
        <FeatureCard header="Scripting" icon={<CodeOutlined />}>
          Use the <a href="/assets/docs/frontend-api/index.html">webKnossos API</a> to create{" "}
          <a href="/scripts">scriptable workflows</a>.{" "}
          <a href="https://www.youtube.com/watch?v=u5j8Sf5YwuM">Watch this demo</a> to learn more.
        </FeatureCard>
        <FeatureCard header="Contact Us" icon={<CustomerServiceOutlined />}>
          <a href="mailto:hello@webknossos.org">Get in touch</a> or{" "}
          <a href="https://forum.image.sc/tag/webknossos" target="_blank" rel="noopener noreferrer">
            write a post in the forum
          </a>
          , if you have any further questions or need help getting started.
        </FeatureCard>
      </Row>
    </StepHeader>
  );

  getAvailableSteps() {
    if (features().isDemoInstance) {
      return [
        { title: "Create Organization", component: this.renderCreateOrganization },
        { title: "Create Account", component: this.renderCreateAccount },
        { title: "What's Next?", component: this.renderWhatsNext },
      ];
    } else {
      return [
        { title: "Create Organization", component: this.renderCreateOrganization },
        { title: "Create Account", component: this.renderCreateAccount },
        { title: "Add Dataset", component: this.renderUploadDatasets },
        { title: "What's Next?", component: this.renderWhatsNext },
      ];
    }
  }

  render = () => {
    const availableSteps = this.getAvailableSteps();
    const currentStepContent = availableSteps[this.state.currentStep].component();

    return (
      <div
        style={{
          minHeight: "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
          paddingBottom: 50,
        }}
      >
        <Row type="flex" justify="center" style={{ padding: "20px 50px 70px" }} align="middle">
          <Col span={18}>
            <Steps current={this.state.currentStep} size="small" style={{ height: 25 }}>
              {availableSteps.map(({ title }) => (
                <Step title={title} key={title} />
              ))}
            </Steps>
          </Col>
        </Row>
        <div style={{ flex: "1 1 auto", display: "flex" }}>
          <Row type="flex" justify="center" style={{ flex: "1 1 auto" }} align="middle">
            <Col span={18}>
              <Row type="flex" justify="center" align="middle">
                <Col span={24}>{currentStepContent}</Col>
              </Row>
            </Col>
          </Row>
        </div>
      </div>
    );
  };
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<StateProps, {||}, _, _, _, _>(mapStateToProps)(withRouter(OnboardingView));
