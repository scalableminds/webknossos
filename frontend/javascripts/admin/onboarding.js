// @flow

import {
  Form,
  Popover,
  Modal,
  Input,
  Button,
  Row,
  Col,
  Steps,
  Icon,
  Card,
  AutoComplete,
  Alert,
} from "antd";
import { type RouterHistory, Link, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import React, { type Node } from "react";

import type { APIUser, APIDataStore } from "admin/api_flow_types";
import Store, { type OxalisState } from "oxalis/store";
import { getDatastores } from "admin/admin_rest_api";
import { location } from "libs/window";
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
  showDatasetUploadModal: boolean,
};

export function WhatsNextBanner() {
  const columnSpan = { xs: 24, sm: 24, md: 12, lg: 12, xl: 8, xxl: 8 };

  const welcomeHeader = (
    <Row type="flex" gutter={50}>
      <Col span={4}>
        <Icon type="rocket" className="icon-big" />
      </Col>
      <Col span={20}>
        <h2>Welcome to your webKnossos account!</h2>
        <p>
          <strong>You are now logged in and ready to go!</strong>
        </p>

        <Row type="flex" gutter={50}>
          <Col {...columnSpan} style={{ padding: 12 }}>
            <Link to="/dashboard/publications?showWhatsNextBanner">
              <Card style={{ textAlign: "center", height: "100%" }}>
                <div style={{ fontSize: 30 }}>
                  <Icon type="play-circle-o" />
                </div>
                <p style={{ fontWeight: "bold", fontSize: 16 }}>Start To Explore Datasets</p>
              </Card>
            </Link>
          </Col>
          <Col {...columnSpan} style={{ padding: 12 }}>
            <Link to="/datasets/upload">
              <Card style={{ textAlign: "center", height: "100%" }}>
                <div style={{ fontSize: 30 }}>
                  <Icon type="cloud-upload-o" />
                </div>
                <p style={{ fontWeight: "bold", fontSize: 16 }}>Upload your Data</p>
              </Card>
            </Link>
          </Col>
          <Col {...columnSpan} style={{ padding: 12 }}>
            <Link to="/users">
              <Card style={{ textAlign: "center", height: "100%" }}>
                <div style={{ fontSize: 30 }}>
                  <Icon type="team" />
                </div>
                <p style={{ fontWeight: "bold", fontSize: 16 }}>Start Collaborating</p>
              </Card>
            </Link>
          </Col>
        </Row>
      </Col>
    </Row>
  );

  return (
    <Alert
      description={welcomeHeader}
      type="info"
      closable
      style={{ marginTop: 20, marginBottom: 20, padding: 40, paddingLeft: 60 }}
    />
  );
}

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
    <div style={{}}>
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
        bodyStyle={{
          textAlign: "center",
          height,
          width: 350,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-around",
        }}
      >
        <div style={{ fontSize: 30 }}>{icon}</div>
        <p style={{ fontWeight: "bold" }}>{header}</p>
        <p style={{ color: "gray" }}>{children}</p>
        <p>{action}</p>
      </Card>
    </div>
  );
}

export class InviteUsersPopover extends React.Component<{
  organizationName: string,
  visible?: boolean,
  handleVisibleChange?: Function,
  children: Node,
}> {
  getRegistrationHotLink(): string {
    return `${location.origin}/auth/register?organizationName=${encodeURIComponent(
      this.props.organizationName,
    )}`;
  }

  copyRegistrationCopyLink = async () => {
    await Clipboard.copy(this.getRegistrationHotLink());
    Toast.success("Registration link copied to clipboard.");
  };

  getContent() {
    return (
      <React.Fragment>
        <div style={{ marginBottom: 8 }}>
          Share the following link to let users join your organization:
        </div>
        <Input.Group compact>
          <Input style={{ width: "85%" }} value={this.getRegistrationHotLink()} readOnly />
          <Button style={{ width: "15%" }} onClick={this.copyRegistrationCopyLink} icon="copy" />
        </Input.Group>
      </React.Fragment>
    );
  }

  render() {
    return (
      <Popover
        trigger="click"
        visible={this.props.visible}
        onVisibleChange={this.props.handleVisibleChange}
        title="Invite Users"
        content={this.getContent()}
      >
        {this.props.children}
      </Popover>
    );
  }
}

const OrganizationForm = Form.create()(({ form, onComplete }) => {
  const hasErrors = fieldsError => Object.keys(fieldsError).some(field => fieldsError[field]);
  const handleSubmit = e => {
    e.preventDefault();
    form.validateFields((err, values) => {
      if (!err) {
        onComplete(values.organizationName);
      }
    });
  };
  const { getFieldDecorator, getFieldsError, getFieldError, isFieldTouched } = form;

  const organizationNameError =
    isFieldTouched("organizationName") && getFieldError("organizationName");

  return (
    <Form onSubmit={handleSubmit}>
      <Row type="flex" justify="center" style={{ padding: "20px 50px" }} align="middle" gutter={8}>
        <Col span={18}>
          <FormItem
            validateStatus={organizationNameError ? "error" : ""}
            help={organizationNameError || ""}
            style={{ width: "100%" }}
          >
            {getFieldDecorator("organizationName", {
              rules: [{ required: true, message: "Please enter an organization name!" }],
              initialValue: "",
            })(
              <AutoComplete
                size="large"
                dataSource={[]}
                defaultActiveFirstOption={false}
                placeholder="Your organization name"
              />,
            )}
          </FormItem>
        </Col>
        <Col span={6}>
          <FormItem>
            {
              <Button
                size="large"
                type="primary"
                icon="plus"
                style={{ width: "100%" }}
                htmlType="submit"
                disabled={hasErrors(getFieldsError())}
              >
                Create
              </Button>
            }
          </FormItem>
        </Col>
      </Row>
    </Form>
  );
});

class OnboardingView extends React.PureComponent<Props, State> {
  state = {
    currentStep: 0,
    datastores: [],
    organizationName: "",
    showDatasetUploadModal: false,
    datasetNameToImport: null,
  };

  componentDidMount() {
    if (this.props.activeUser != null) {
      this.props.history.push("/dashboard");
      return;
    }

    this.fetchData();
  }

  async fetchData() {
    const datastores = (await getDatastores()).filter(ds => !ds.isForeign && !ds.isConnector);
    this.setState({ datastores });
  }

  advanceStep = () => {
    this.setState(prevState => ({
      currentStep: prevState.currentStep + 1,
      showDatasetUploadModal: false,
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
      icon={<i className="fa fa-building icon-big" />}
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
      icon={<Icon type="user" className="icon-big" />}
    >
      <RegistrationForm
        hidePrivacyStatement
        createOrganization
        organizationName={this.state.organizationName}
        onRegistered={() => {
          // Update the entered organization to the normalized name of the organization received by the backend.
          // This is needed for further requests.
          const { activeUser } = Store.getState();
          if (activeUser) {
            this.setState({ organizationName: activeUser.organization });
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
      icon={<Icon type="file-add" className="icon-big" />}
    >
      {this.state.showDatasetUploadModal && (
        <Modal
          visible
          width="85%"
          footer={null}
          maskClosable={false}
          onCancel={() => this.setState({ showDatasetUploadModal: false })}
        >
          <DatasetUploadView
            datastores={this.state.datastores}
            onUploaded={(_organization: string, datasetName: string) => {
              this.setState({ datasetNameToImport: datasetName, showDatasetUploadModal: false });
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
          icon={<Icon type="cloud-upload-o" />}
          action={
            <Button onClick={() => this.setState({ showDatasetUploadModal: true })}>
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
          icon={<Icon type="rocket" />}
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
          icon={<Icon type="clock-circle-o" />}
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
      icon={<Icon type="rocket" className="icon-big" />}
    >
      <Row type="flex" gutter={50}>
        <FeatureCard header="Data Annotation" icon={<Icon type="play-circle-o" />}>
          <a href="/dashboard">Explore and annotate your data.</a> For a brief overview,{" "}
          <a href="https://youtu.be/W-dosptovEU?t=52">watch this video</a>.
        </FeatureCard>
        <FeatureCard header="More Datasets" icon={<Icon type="cloud-upload-o" />}>
          <a href="/datasets/upload">Upload more of your datasets.</a>{" "}
          <a href="https://docs.webknossos.org/reference/data_formats">Learn more</a> about the
          formats and upload processes webKnossos supports.
        </FeatureCard>
        <FeatureCard header="User & Team Management" icon={<Icon type="team" />}>
          <InviteUsersPopover
            organizationName={
              this.props.activeUser != null ? this.props.activeUser.organization : ""
            }
          >
            <a href="#">Invite users</a>{" "}
          </InviteUsersPopover>
          and assign them to <a href="/teams">teams</a>. Teams can be used to define dataset
          permissions and task assignments.
        </FeatureCard>
        <FeatureCard header="Project Management" icon={<Icon type="paper-clip" />}>
          Create <a href="/tasks">tasks</a> and <a href="/projects">projects</a> to efficiently
          accomplish your research goals.{" "}
          <a href="https://www.youtube.com/watch?v=4DD7408avUY">Watch this demo</a> to learn more.
        </FeatureCard>
        <FeatureCard header="Scripting" icon={<Icon type="code-o" />}>
          Use the <a href="/assets/docs/frontend-api/index.html">webKnossos API</a> to create{" "}
          <a href="/scripts">scriptable workflows</a>.{" "}
          <a href="https://www.youtube.com/watch?v=u5j8Sf5YwuM">Watch this demo</a> to learn more.
        </FeatureCard>
        <FeatureCard header="Contact Us" icon={<Icon type="customer-service" />}>
          <a href="mailto:hello@scalableminds.com">Get in touch</a>, if you have any further
          questions or need help getting started.
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
