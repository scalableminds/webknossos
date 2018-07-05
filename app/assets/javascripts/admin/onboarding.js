// @flow

import * as React from "react";
import { Input, Button, Row, Col, Steps, Icon } from "antd";
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
};

class OnboardingView extends React.PureComponent<Props, State> {
  constructor() {
    super();
    this.state = {
      currentStep: 0,
    };
  }

  advanceStep = () => {
    this.setState({ currentStep: this.state.currentStep + 1 });
  };

  renderCreateOrganization() {
    return (
      <React.Fragment>
        <div style={{ textAlign: "center", paddingBottom: 32, marginTop: -32 }}>
          <i className="fa fa-building" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
          <p style={{ fontSize: 24, margin: "14px 0 0" }}>Create your organization</p>
          <p
            style={{
              fontSize: 14,
              margin: "14px 0",
              color: "gray",
              display: "inline-block",
              width: 500,
            }}
          >
            Within an organization, users can register and datasets can be uploaded. Granular
            management and permissions can be achieved by creating teams.
          </p>
        </div>
        <Row
          type="flex"
          justify="center"
          style={{ padding: "20px 50px" }}
          align="middle"
          gutter={8}
        >
          <Col span={18}>
            <Input size="large" placeholder="Your organization name" autoFocus />
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
      </React.Fragment>
    );
  }

  renderCreateAccount() {
    return (
      <React.Fragment>
        <div style={{ textAlign: "center", paddingBottom: 32 }}>
          <Icon type="user" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
          <p style={{ fontSize: 24, margin: "14px 0 0" }}>Create an admin account</p>
          <p
            style={{
              fontSize: 14,
              margin: "14px 0",
              color: "gray",
              display: "inline-block",
              width: 500,
            }}
          >
            This will be the first admin account. It can be used to confirm user registrations,
            define teams, create tasks and much more.
          </p>
        </div>
        <RegistrationForm
          hidePrivacyStatement
          organizationId="some_orgid"
          onRegistered={this.advanceStep}
          confirmLabel="Create account"
        />
      </React.Fragment>
    );
  }

  renderUploadDatasets() {
    return (
      <React.Fragment>
        <div style={{ textAlign: "center", paddingBottom: 32 }}>
          <Icon type="cloud-upload" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
          <p style={{ fontSize: 24, margin: "14px 0 0" }}>
            Upload the first dataset into your organization.
          </p>
          <p
            style={{
              fontSize: 14,
              margin: "14px 0",
              color: "gray",
              display: "inline-block",
              width: 500,
            }}
          >
            You can upload a dataset via drag and drop or by copying the dataset on the hosting
            server (recommended for file sizes larger than 1 GB).
          </p>
        </div>
        <DatasetUploadView history={this.props.history} withoutCard />
      </React.Fragment>
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
