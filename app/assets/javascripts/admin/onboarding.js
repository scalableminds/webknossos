// @flow

import * as React from "react";
import { Input, Button, Row, Col, Steps, Icon, Card } from "antd";
import { withRouter } from "react-router-dom";

import RegistrationForm from "admin/auth/registration_form";
import DatasetUploadView from "admin/dataset/dataset_upload_view";

import type { RouterHistory } from "react-router-dom";

const Step = Steps.Step;

type Props = {
  history: RouterHistory,
};

type State = {
  currentStep: number,
  organizationName: string,
};

function StepHeader({ header, subheader, icon, children }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ paddingBottom: 32, marginTop: -32 }}>
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
  return (
    <Card style={{ textAlign: "center" }}>
      <div style={{ fontSize: 30 }}>{icon}</div>
      <p style={{ fontWeight: "bold" }}>{header}</p>
      <p style={{ color: "gray" }}>{children}</p>
    </Card>
  );
}

class OnboardingView extends React.PureComponent<Props, State> {
  constructor() {
    super();
    this.state = {
      currentStep: 0,
      organizationName: "",
    };
  }

  advanceStep = () => {
    this.setState({ currentStep: this.state.currentStep + 1 });
  };

  renderCreateOrganization() {
    return (
      <StepHeader
        header="Create Your Organization"
        subheader="Create an organization to manage users and datasets."
        icon={
          <i className="fa fa-building" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
        }
      >
        <Row
          type="flex"
          justify="center"
          style={{ padding: "20px 50px" }}
          align="middle"
          gutter={8}
        >
          <Col span={18}>
            <Input
              size="large"
              placeholder="Your organization name"
              autoFocus
              value={this.state.organizationName}
              onChange={event => this.setState({ organizationName: event.target.value })}
            />
          </Col>
          <Col span={6}>
            <Button
              size="large"
              type="primary"
              icon="plus"
              onClick={this.advanceStep}
              style={{ width: "100%" }}
            >
              Create
            </Button>
          </Col>
        </Row>
      </StepHeader>
    );
  }

  renderCreateAccount() {
    return (
      <StepHeader
        header="Create an Admin Account"
        subheader="This will be the first admin account. It can be used to confirm user registrations,
            define teams, create tasks and much more."
        icon={<Icon type="user" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />}
      >
        <RegistrationForm
          hidePrivacyStatement
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
          <div>
            You can upload a dataset via drag and drop or by directly copying the dataset on the
            hosting server. Learn more details{" "}
            <a href="https://github.com/scalableminds/webknossos/wiki/Datasets">here</a>.
          </div>
        }
        icon={<Icon type="cloud-upload" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />}
      >
        <DatasetUploadView history={this.props.history} withoutCard />
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
      </StepHeader>
    );
  }

  renderWhatsNext() {
    return (
      <StepHeader
        header="Congratulations!"
        subheader="The initial setup is done. Learn more about the features and concepts which webKnossos
            provides."
        icon={<Icon type="rocket" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />}
      >
        <Row type="flex" gutter={50} align="middle" style={{ marginBottom: 24 }}>
          <Col span={8}>
            <FeatureCard header="User & Team Management" icon={<Icon type="team" />}>
              Invite users and assign them to <a href="/teams">teams</a>. Teams can be used to
              define dataset permissions and task assignments.
            </FeatureCard>
          </Col>
          <Col span={8}>
            <FeatureCard header="Data Annotation" icon={<Icon type="play-circle-o" />}>
              View and annotate your data. Watch this{" "}
              <a href="https://youtu.be/W-dosptovEU?t=52">video</a> for a brief overview.
            </FeatureCard>
          </Col>
          <Col span={8}>
            <FeatureCard header="More Datasets" icon={<Icon type="cloud-upload-o" />}>
              Upload more datasets. Read{" "}
              <a href="https://github.com/scalableminds/webknossos/wiki/Datasets">here</a> which
              formats and upload processes we support.
            </FeatureCard>
          </Col>
        </Row>
        <Row type="flex" gutter={50} align="middle">
          <Col span={8}>
            <FeatureCard header="Project Management" icon={<Icon type="paper-clip" />}>
              Create projects and tasks to accomplish your research goals. See{" "}
              <a href="https://www.youtube.com/watch?v=4DD7408avUY">here</a> for a demo.
            </FeatureCard>
          </Col>
          <Col span={8}>
            <FeatureCard header="Scripting" icon={<Icon type="code-o" />}>
              Use the webKnossos API to create scriptable workflows. Watch this{" "}
              <a href="https://www.youtube.com/watch?v=u5j8Sf5YwuM">demo</a> to learn more.
            </FeatureCard>
          </Col>
          <Col span={8}>
            <FeatureCard header="Contact Us" icon={<Icon type="customer-service" />}>
              <a href="mailto:hello@scalableminds.com">Get in touch</a>, if you have any further
              questions or need help getting started.
            </FeatureCard>
          </Col>
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
      <div style={{ height: "calc(100vh - 48px)", display: "flex", flexDirection: "column" }}>
        <Row type="flex" justify="center" style={{ padding: "20px 50px" }} align="middle">
          <Col span={18}>
            <Steps current={this.state.currentStep} size="small" style={{ height: 25 }}>
              <Step title="Create Organization" onClick={() => this.setState({ currentStep: 0 })} />
              <Step title="Create Account" onClick={() => this.setState({ currentStep: 1 })} />
              <Step title="Upload Dataset" onClick={() => this.setState({ currentStep: 2 })} />
              <Step title="What's Next?" onClick={() => this.setState({ currentStep: 3 })} />
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

export default withRouter(OnboardingView);
