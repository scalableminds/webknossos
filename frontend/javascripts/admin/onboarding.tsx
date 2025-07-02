import {
  ClockCircleOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  CustomerServiceOutlined,
  FileAddOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RocketOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import RegistrationFormGeneric from "admin/auth/registration_form_generic";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import { maxInludedUsersInBasicPlan } from "admin/organization/pricing_plan_utils";
import { getDatastores, sendInvitesForOrganization } from "admin/rest_api";
import { Alert, AutoComplete, Button, Card, Col, Form, Input, Modal, Row, Steps } from "antd";
import CreditsFooter from "components/credits_footer";
import LinkButton from "components/link_button";
import DatasetSettingsView from "dashboard/dataset/dataset_settings_view";
import features from "features";
import Toast from "libs/toast";
import { type RouteComponentProps, withRouter } from "libs/with_router_hoc";
import React, { useState } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import type { APIDataStore, APIUser } from "types/api_types";
import type { WebknossosState } from "viewer/store";
import Store from "viewer/store";

const { Step } = Steps;
const FormItem = Form.Item;
type StateProps = {
  activeUser: APIUser | null | undefined;
};
type Props = StateProps & RouteComponentProps;
type State = {
  currentStep: number;
  datastores: Array<APIDataStore>;
  organizationId: string;
  datasetIdToImport: string | null | undefined;
  isDatasetUploadModalVisible: boolean;
  isInviteModalVisible: boolean;
};

function StepHeader({
  header,
  subheader,
  icon,
  children,
}: {
  header: string;
  subheader: React.ReactNode;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          paddingBottom: 32,
          textAlign: "center",
        }}
      >
        {icon}
        <p
          style={{
            fontSize: 24,
            margin: "14px 0 0",
          }}
        >
          {header}
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
          {subheader}
        </p>
      </div>
      {children}
    </div>
  );
}

function FeatureCard({
  icon,
  header,
  children,
}: {
  icon: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const columnSpan = {
    xs: 24,
    sm: 24,
    md: 12,
    lg: 12,
    xl: 8,
    xxl: 8,
  };
  return (
    <Col
      {...columnSpan}
      style={{
        padding: 12,
      }}
    >
      <Card
        style={{
          textAlign: "center",
          height: "100%",
        }}
      >
        <div
          style={{
            fontSize: 30,
          }}
        >
          {icon}
        </div>
        <p
          style={{
            fontWeight: "bold",
          }}
        >
          {header}
        </p>
        <p
          style={{
            color: "gray",
          }}
        >
          {children}
        </p>
      </Card>
    </Col>
  );
}

type OptionCardProps = {
  icon: React.ReactNode;
  header: string;
  children: React.ReactNode;
  action: React.ReactNode;
  height: number;
};
export function OptionCard({ icon, header, children, action, height }: OptionCardProps) {
  return (
    <div
      style={{
        padding: 12,
      }}
    >
      <Card
        bordered={false}
        styles={{
          body: {
            textAlign: "center",
            height,
            width: 350,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-around",
            boxShadow: "var(--ant-box-shadow)",
            borderRadius: 3,
            border: 0,
          },
        }}
      >
        <div
          style={{
            fontSize: 32,
            background: "var(--ant-color-primary)",
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
            marginBottom: 0,
          }}
        >
          {header}
        </h1>
        <p
          style={{
            fontSize: 14,
            lineHeight: "18px",
            color: "var(--ant-color-text-secondary)",
            margin: 0,
          }}
        >
          {children}
        </p>
        <p>{action}</p>
      </Card>
    </div>
  );
}

export function InviteUsersModal({
  organizationId,
  isOpen,
  handleVisibleChange,
  destroy,
  currentUserCount = 1,
  maxUserCountPerOrganization = maxInludedUsersInBasicPlan, // default for Basic Plan,
}: {
  organizationId: string;
  isOpen?: boolean;
  handleVisibleChange?: (...args: Array<any>) => any;
  destroy?: (...args: Array<any>) => any;
  currentUserCount?: number;
  maxUserCountPerOrganization?: number;
}) {
  const [inviteesString, setInviteesString] = useState("");
  const isOrganizationLimitAlreadyReached = currentUserCount >= maxUserCountPerOrganization;

  function extractEmailAddresses(): string[] {
    return inviteesString
      .split(/[,\s]+/)
      .map((a) => a.trim())
      .filter((lines) => lines.includes("@"));
  }

  async function sendInvite() {
    const addresses = extractEmailAddresses();

    await sendInvitesForOrganization(addresses, true);
    Toast.success("An invitation was sent to the provided email addresses.");

    setInviteesString("");
    if (handleVisibleChange != null) handleVisibleChange(false);
    if (destroy != null) destroy();
  }

  const doNewUsersExceedLimit =
    currentUserCount + extractEmailAddresses().length > maxUserCountPerOrganization;

  function getContent() {
    const exceedingUserLimitAlert = doNewUsersExceedLimit ? (
      <Alert
        showIcon
        type="warning"
        description="Inviting more new users will exceed your organization's user limit. Consider upgrading your WEBKNOSSOS plan."
        style={{ marginBottom: 10 }}
        action={
          <Link to={`/organizations/${organizationId}`}>
            <Button size="small" type="primary">
              Upgrade Now
            </Button>
          </Link>
        }
      />
    ) : null;

    return (
      <React.Fragment>
        <p>
          Send an email to invite your colleagues and collaboration partners to your organization.
          Share datasets, collaboratively work on annotations, and organize complex analysis
          projects.
        </p>
        <p>Multiple email addresses should be separated with a comma, a space or a new line.</p>
        <p>
          Note that new users have limited access permissions by default. Please doublecheck their
          roles and team assignments after they join your organization.
        </p>
        {isOrganizationLimitAlreadyReached ? (
          <p>
            As your organization has reached its user limit, you can only invite guests to your
            organization. Those users must already be part of an organization paying for their
            account.
          </p>
        ) : null}
        {exceedingUserLimitAlert}
        <Input.TextArea
          spellCheck={false}
          autoSize={{
            minRows: 6,
          }}
          onChange={(evt) => {
            setInviteesString(evt.target.value);
          }}
          placeholder={"jane@example.com\njoe@example.com"}
          defaultValue={inviteesString}
        />
      </React.Fragment>
    );
  }

  return (
    <Modal
      open={isOpen == null ? true : isOpen}
      title={
        <>
          <UserAddOutlined /> Invite {isOrganizationLimitAlreadyReached ? "Guests" : "Users"}
        </>
      }
      width={600}
      footer={
        <Button onClick={sendInvite} type="primary">
          Send Invite Emails
        </Button>
      }
      onCancel={() => {
        if (handleVisibleChange != null) handleVisibleChange(false);
        if (destroy != null) destroy();
      }}
      closable
    >
      {getContent()}
    </Modal>
  );
}

const OrganizationForm = ({ onComplete }: { onComplete: (args: any) => void }) => {
  const [form] = Form.useForm();

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'values' implicitly has an 'any' type.
  const onFinish = (values) => {
    onComplete(values.organizationId);
  };

  return (
    <Form
      onFinish={onFinish}
      form={form}
      initialValues={{
        organizationId: "",
      }}
    >
      <Row
        justify="center"
        style={{
          padding: "20px 50px",
        }}
        align="middle"
        gutter={8}
      >
        <Col span={18}>
          <FormItem
            style={{
              width: "100%",
            }}
            rules={[
              {
                required: true,
                message: "Please enter an organization name!",
              },
            ]}
            name="organizationId"
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
              style={{
                width: "100%",
              }}
              htmlType="submit"
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
  state: State = {
    currentStep: 0,
    datastores: [],
    organizationId: "",
    isDatasetUploadModalVisible: false,
    isInviteModalVisible: false,
    datasetIdToImport: null,
  };

  componentDidMount() {
    if (this.props.activeUser != null) {
      this.props.navigate("/dashboard");
    }
  }

  async fetchDatastores() {
    const datastores = await getDatastores();
    this.setState({
      datastores,
    });
  }

  advanceStep = () => {
    this.setState((prevState) => ({
      currentStep: prevState.currentStep + 1,
      isDatasetUploadModalVisible: false,
      isInviteModalVisible: false,
      datasetIdToImport: null,
    }));
  };
  renderCreateOrganization = () => (
    <StepHeader
      header="Create or Join an Organization"
      subheader={
        <React.Fragment>
          Welcome to WEBKNOSSOS! This guide will help you get started.
          <br />
          Setup your organization to manage users and datasets. Example names: &ldquo;University of
          Springfield&rdquo;, &ldquo;Simpsons Lab&rdquo;, &ldquo;Neuroscience Department&rdquo;
        </React.Fragment>
      }
      icon={<i className="far fa-building icon-big" />}
    >
      <OrganizationForm
        onComplete={(organizationId) => {
          this.setState({
            organizationId,
          });
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
      <RegistrationFormGeneric
        hidePrivacyStatement
        organizationIdToCreate={this.state.organizationId}
        onRegistered={() => {
          // Update the entered organization to the normalized name of the organization received by the backend.
          // This is needed for further requests.
          const { activeUser } = Store.getState();

          if (activeUser) {
            this.setState({
              organizationId: activeUser.organization,
            });
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
      subheader="Upload your dataset via drag and drop"
      icon={<FileAddOutlined className="icon-big" />}
    >
      {this.state.isDatasetUploadModalVisible && (
        <Modal
          open
          width="85%"
          footer={null}
          maskClosable={false}
          onCancel={() =>
            this.setState({
              isDatasetUploadModalVisible: false,
            })
          }
        >
          <DatasetUploadView
            datastores={this.state.datastores}
            onUploaded={async (
              uploadedDatasetId: string,
              _uploadedDatasetName: string,
              needsConversion: boolean,
            ) => {
              this.setState({
                datasetIdToImport: uploadedDatasetId,
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
      {this.state.datasetIdToImport != null && (
        <Modal open width="85%" footer={null} maskClosable={false} onCancel={this.advanceStep}>
          <DatasetSettingsView
            isEditingMode={false}
            datasetId={this.state.datasetIdToImport}
            onComplete={this.advanceStep}
            onCancel={this.advanceStep}
          />
        </Modal>
      )}
      <Row gutter={16} justify="center" align="bottom">
        <OptionCard
          header="Upload Dataset"
          icon={<CloudUploadOutlined />}
          action={
            <Button
              onClick={() =>
                this.setState({
                  isDatasetUploadModalVisible: true,
                })
              }
            >
              Upload your dataset
            </Button>
          }
          height={250}
        >
          You can also copy it directly onto the hosting server.{" "}
          <a href="https://docs.webknossos.org/webknossos/data/index.html">
            Learn more about supported data formats.
          </a>
        </OptionCard>
        <OptionCard
          header="Skip"
          icon={<ClockCircleOutlined />}
          action={<LinkButton onClick={this.advanceStep}>Skip this step</LinkButton>}
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
          the features and concepts of WEBKNOSSOS.
        </React.Fragment>
      }
      icon={<RocketOutlined className="icon-big" />}
    >
      <Row gutter={50}>
        <FeatureCard header="Data Annotation" icon={<PlayCircleOutlined />}>
          <a href="/dashboard">Explore and annotate your data.</a> For a brief overview,{" "}
          <a href="https://www.youtube.com/watch?v=iw2C7XB6wP4">watch this video</a>.
        </FeatureCard>
        <FeatureCard header="More Datasets" icon={<CloudUploadOutlined />}>
          <a href="/datasets/upload">Upload more of your datasets.</a>{" "}
          <a href="https://docs.webknossos.org/webknossos/data/index.html">Learn more</a> about the
          formats and upload processes WEBKNOSSOS supports.
        </FeatureCard>
        <FeatureCard header="User & Team Management" icon={<TeamOutlined />}>
          <LinkButton
            onClick={() =>
              this.setState({
                isInviteModalVisible: true,
              })
            }
          >
            Invite users to work collaboratively
          </LinkButton>{" "}
          <InviteUsersModal
            organizationId={this.state.organizationId}
            isOpen={this.state.isInviteModalVisible}
            handleVisibleChange={(isInviteModalVisible) =>
              this.setState({
                isInviteModalVisible,
              })
            }
          />
          and assign them to <a href="/teams">teams</a>. Teams can be used to define dataset
          permissions and task assignments.
        </FeatureCard>
        <FeatureCard header="Project Management" icon={<PaperClipOutlined />}>
          Create <a href="/tasks">tasks</a> and <a href="/projects">projects</a> to efficiently
          accomplish your research goals.{" "}
          <a href="https://www.youtube.com/watch?v=G6AumzpIzR0">Watch this short video</a> to learn
          more.
        </FeatureCard>
        <FeatureCard header="Scripting" icon={<CodeOutlined />}>
          Use the <a href="https://docs.webknossos.org/webknossos-py">WEBKNOSSOS Python library</a>{" "}
          to create automated workflows.
          <a href="https://www.youtube.com/watch?v=JABaGvqg2-g">Watch this short video</a> to learn
          more.
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
    if (features().isWkorgInstance) {
      return [
        {
          title: "Create Organization",
          component: this.renderCreateOrganization,
        },
        {
          title: "Create Account",
          component: this.renderCreateAccount,
        },
        {
          title: "What's Next?",
          component: this.renderWhatsNext,
        },
      ];
    } else {
      return [
        {
          title: "Create Organization",
          component: this.renderCreateOrganization,
        },
        {
          title: "Create Account",
          component: this.renderCreateAccount,
        },
        {
          title: "Add Dataset",
          component: this.renderUploadDatasets,
        },
        {
          title: "What's Next?",
          component: this.renderWhatsNext,
        },
      ];
    }
  }

  render() {
    const availableSteps = this.getAvailableSteps();
    const currentStepContent = availableSteps[this.state.currentStep].component();
    return (
      <>
        <div className="onboarding">
          <Row
            justify="center"
            style={{
              padding: "20px 50px 70px",
            }}
            align="middle"
          >
            <Col span={18}>
              <Steps
                current={this.state.currentStep}
                size="small"
                style={{
                  height: 25,
                }}
              >
                {availableSteps.map(({ title }) => (
                  <Step title={title} key={title} />
                ))}
              </Steps>
            </Col>
          </Row>
          <div
            style={{
              flex: "1 1 auto",
              display: "flex",
            }}
          >
            <Row
              justify="center"
              style={{
                flex: "1 1 auto",
              }}
              align="middle"
            >
              <Col span={18}>
                <Row justify="center" align="middle">
                  <Col span={24}>{currentStepContent}</Col>
                </Row>
              </Col>
            </Row>
          </div>
        </div>
        <CreditsFooter />
      </>
    );
  }
}

const mapStateToProps = (state: WebknossosState): StateProps => ({
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(withRouter<Props>(OnboardingView));
