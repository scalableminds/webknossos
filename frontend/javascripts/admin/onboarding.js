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
} from "antd";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import React, { type Node, useState, useEffect } from "react";
import { Link } from "react-router-dom";

import type { APIUser, APIDataStore } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { location } from "libs/window";
import DatasetImportView from "dashboard/dataset/dataset_import_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import RegistrationForm from "admin/auth/registration_form";
import Toast from "libs/toast";
import { getOrganizations, getDatastores } from "admin/admin_rest_api";

const { Step } = Steps;
const FormItem = Form.Item;

type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = StateProps;

type State = {
  currentStep: number,
  datastores: Array<APIDataStore>,
  organizationName: string,
  datasetNameToImport: ?string,
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
  const [organizations, setOrganizations] = useState([]);
  const fetchOrganizations = async () =>
    setOrganizations((await getOrganizations()).map(org => org.name));
  useEffect(() => {
    fetchOrganizations();
  }, []);

  const joinExistingOrganization = organizations.includes(form.getFieldValue("organizationName"));

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
            })(
              <AutoComplete
                size="large"
                dataSource={organizations}
                defaultActiveFirstOption={false}
                placeholder="Your organization name"
              />,
            )}
          </FormItem>
        </Col>
        <Col span={6}>
          <FormItem>
            {joinExistingOrganization ? (
              <Link
                to={`/auth/register?organizationName=${form.getFieldValue("organizationName")}`}
              >
                <Button size="large" type="primary" style={{ width: "100%" }}>
                  Join
                </Button>
              </Link>
            ) : (
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
            )}
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
    datasetNameToImport: null,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const datastores = (await getDatastores()).filter(ds => !ds.isForeign && !ds.isConnector);
    this.setState({ datastores });
  }

  advanceStep = () => {
    this.setState(prevState => ({
      currentStep: prevState.currentStep + 1,
      datasetNameToImport: null,
    }));
  };

  renderCreateOrganization() {
    return (
      <StepHeader
        header="Create or Join an Organization"
        subheader={
          <React.Fragment>
            Welcome to webKnossos! This guide will help you get started.
            <br />
            Setup your organization to manage users and datasets. Example names: &ldquo;University
            of Springfield&rdquo;, &ldquo;Simpsons Lab&rdquo;, &ldquo;Neuroscience Department&rdquo;
          </React.Fragment>
        }
        icon={
          <i className="fa fa-building" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
        }
      >
        <OrganizationForm
          onComplete={organizationName => {
            this.setState({ organizationName });
            this.advanceStep();
          }}
        />
      </StepHeader>
    );
  }

  renderCreateAccount() {
    return (
      <StepHeader
        header="Create an Admin Account"
        subheader={
          <React.Fragment>
            This will be the first user account in your organization. It will be equipped with admin
            privileges in order to confirm user registrations, define teams, create tasks and much
            more.
          </React.Fragment>
        }
        icon={<Icon type="user" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />}
      >
        <RegistrationForm
          hidePrivacyStatement
          createOrganization
          organizationName={this.state.organizationName}
          onRegistered={this.advanceStep}
          confirmLabel="Create account"
          tryAutoLogin
        />
      </StepHeader>
    );
  }

  renderUploadDatasets() {
    return (
      <StepHeader
        header="Upload the first dataset into your organization."
        subheader={
          <React.Fragment>
            Upload your dataset via drag and drop or by directly copying the dataset on the hosting
            server.{" "}
            <a href="https://docs.webknossos.org/reference/data_formats">
              Learn more about supported data formats.
            </a>
          </React.Fragment>
        }
        icon={<Icon type="cloud-upload" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />}
      >
        {this.state.datasetNameToImport == null ? (
          <DatasetUploadView
            datastores={this.state.datastores}
            onUploaded={datasetName => {
              this.setState({ datasetNameToImport: datasetName });
            }}
            withoutCard
          />
        ) : (
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
        <div style={{ textAlign: "center" }}>
          <a
            href="#"
            onClick={this.advanceStep}
            style={{
              fontSize: 14,
              color: "gray",
              display: "inline-block",
            }}
          >
            Or skip this step
          </a>
        </div>
      </StepHeader>
    );
  }

  renderWhatsNext() {
    return (
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
        icon={<Icon type="rocket" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />}
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
            Use the <a href="/docs/frontend-api/index.html">webKnossos API</a> to create{" "}
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
  }

  render() {
    const currentStepContent = (() => {
      switch (this.state.currentStep) {
        case 0:
          return this.renderCreateOrganization();
        case 1:
          return this.renderCreateAccount();
        case 2:
          return this.renderUploadDatasets();
        case 3:
          return this.renderWhatsNext();
        default:
          return null;
      }
    })();

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
              <Step title="Create Organization" />
              <Step title="Create Account" />
              <Step title="Upload Dataset" />
              <Step title="What's Next?" />
            </Steps>
          </Col>
        </Row>
        <div style={{ flex: "1 1 auto", display: "flex" }}>
          <Row type="flex" justify="center" style={{ flex: "1 1 auto" }} align="middle">
            <Col span={18}>
              <Row type="flex" justify="center" align="middle">
                <Col span={18}>{currentStepContent}</Col>
              </Row>
            </Col>
          </Row>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(OnboardingView);
