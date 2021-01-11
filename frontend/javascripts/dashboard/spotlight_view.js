// @flow
import { Link, withRouter, type RouterHistory } from "react-router-dom";
import { Spin, Layout, Row, Col, Card, Input } from "antd";
import { connect } from "react-redux";
import * as React from "react";

import type { APIMaybeUnimportedDataset, APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { checkAnyOrganizationExists, getDatasets } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import PublicationView from "dashboard/publication_view";
import CreditsFooter from "components/credits_footer";
import features from "features";
import SpotlightRegistrationForm from "dashboard/spotlight_registration_form";

const { Content } = Layout;
const { Search } = Input;

export const SimpleHeader = () => (
  <div id="oxalis-header">
    <img
      src="/assets/images/oxalis.svg"
      alt="webKnossos Logo"
      style={{ verticalAlign: "middle" }}
    />
    webKnossos
  </div>
);

const WelcomeHeader = ({ history }) => (
  <div
    style={{
      backgroundImage: "url(/assets/images/cover.jpg)",
    }}
  >
    <div
      style={{
        backgroundColor: "rgba(88, 88, 88, 0.4)",
        backgroundImage: "linear-gradient(to bottom, #449efd7a 0%, #041a4abf 85%, #00050fc2 100%)",
      }}
    >
      <div
        style={{
          maxWidth: 1300,
          margin: "auto",
          padding: "80px 0px",
        }}
      >
        <Row type="flex" align="middle" style={{ color: "white" }}>
          <Col xs={{ span: 0 }} xl={{ span: 4 }}>
            <img
              src="/assets/images/oxalis.svg"
              alt="webKnossos Logo"
              style={{ filter: "invert(1)", width: "100%" }}
            />
          </Col>
          <Col xs={{ span: 24 }} xl={{ span: 13 }} lg={{ span: 16 }}>
            <p
              style={{
                fontSize: 58,
                textShadow: "rgba(0, 0, 0, 0.38) 0px 1px 6px",
                fontWeight: 300,
                marginLeft: 56,
              }}
            >
              Welcome to webKnossos
            </p>
            <div
              style={{
                padding: "20px 60px",
                textShadow: "rgba(0, 0, 0, 0.38) 0px 1px 6px",
                color: "rgb(243, 243, 248)",
              }}
            >
              <p
                style={{
                  fontSize: 20,
                  lineHeight: 1.5,
                  marginTop: 0,
                }}
              >
                webKnossos is an open-source tool for annotating and exploring large 3D datasets
              </p>
              <ul
                style={{
                  fontSize: 19,
                  paddingLeft: "1.2em",
                }}
              >
                <li>Fly through your data for fast skeletonization and proof-reading</li>
                <li>Create 3D training data for automated segmentations efficiently</li>
                <li>Scale data reconstruction projects with crowdsourcing workflows</li>
                <li>Share datasets and annotations with collaborating scientists</li>
              </ul>
            </div>

            <div style={{ marginBottom: 20, paddingLeft: 60 }}>
              <Link
                to="/features"
                className="spotlight-hero-button ant-btn ant-btn-lg ant-btn-background-ghost"
              >
                Learn More About the Features
              </Link>
              <Link
                to="/pricing"
                className="spotlight-hero-button ant-btn ant-btn-lg ant-btn-background-ghost"
              >
                Get Your Own webKnossos
              </Link>
            </div>
          </Col>
          <Col xs={{ span: 24 }} lg={{ span: 7 }} xl={{ span: 6 }}>
            <div
              style={{
                backgroundColor: "white",
                padding: 20,
                boxShadow: "0 0 10px rgba(0, 0, 0, 0.38)",
              }}
            >
              <SpotlightRegistrationForm
                onRegistered={() => {
                  history.push("/dashboard?showWhatsNextBanner");
                }}
              />
              <p style={{ textAlign: "center" }}>
                <Link to="/auth/login">Log in to existing account</Link>
              </p>
            </div>
          </Col>
        </Row>
      </div>
    </div>
  </div>
);

const MissingDatasetCard = () => (
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      marginTop: 80,
    }}
  >
    <Col className="gallery-dataset-col">
      <a
        href="https://goo.gl/forms/QICmEcQyid6gb8Kw1"
        title="Click to add your missing dataset"
        target="_blank"
        rel="noopener noreferrer"
        className="not-highlighted-link"
      >
        <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card" bordered={false}>
          <div style={{ display: "flex", height: "100%" }}>
            <div className="publication-description">
              <h3>Your dataset is missing here?</h3>
              <div className="publication-description-body nice-scrollbar">
                If you want to add your own dataset to this publication library just click here. It
                opens a form which will contact us so we can add your dataset.
              </div>
            </div>
            <div className="dataset-thumbnail">
              <div
                style={{
                  position: "relative",
                  height: "100%",
                  display: "flex",
                  alignItems: "flex-end",
                }}
              >
                <div
                  className="dataset-click-hint absolute"
                  style={{
                    opacity: 1,
                    backgroundColor: "rgba(0, 0, 0, 0.4)",
                    fontSize: 220,
                  }}
                >
                  ?
                </div>
                <div className="dataset-thumbnail-image absolute" id="add-missing-dataset-image" />
              </div>
            </div>
          </div>
        </Card>
      </a>
    </Col>
  </div>
);

type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = StateProps;
type PropsWithRouter = {| ...Props, history: RouterHistory |};

type State = {
  datasets: Array<APIMaybeUnimportedDataset>,
  hasOrganizations: boolean,
  isLoading: boolean,
  searchQuery: string,
};

class SpotlightView extends React.PureComponent<PropsWithRouter, State> {
  state = {
    datasets: [],
    hasOrganizations: true,
    isLoading: true,
    searchQuery: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({ isLoading: true });
      const [datasets, hasOrganizations] = await Promise.all([
        getDatasets(),
        checkAnyOrganizationExists(),
      ]);
      this.setState({ datasets, hasOrganizations });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  handleSearch = (event: SyntheticInputEvent<>) => {
    this.setState({ searchQuery: event.target.value });
  };

  render() {
    const useOnboardingFlow =
      this.props.activeUser == null && (features().isDemoInstance || !this.state.hasOrganizations);

    const search = (
      <Search
        style={{ width: 200, float: "right" }}
        placeholder="Search Publication"
        onPressEnter={this.handleSearch}
        onChange={this.handleSearch}
        value={this.state.searchQuery}
      />
    );

    return (
      <Layout>
        {useOnboardingFlow ? <WelcomeHeader history={this.props.history} /> : <SimpleHeader />}
        <Content className="centered-content">
          <div className="pull-right">{this.state.datasets.length > 0 && search}</div>
          <h3>Featured Publications</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />
          <Spin size="large" spinning={this.state.isLoading}>
            <div style={{ minHeight: "100px" }}>
              {this.state.datasets.length === 0 && !this.state.isLoading ? (
                <React.Fragment>
                  <p style={{ textAlign: "center" }}>There are no publications yet.</p>
                  <p style={{ textAlign: "center" }}>
                    <Link to={useOnboardingFlow ? "/" : "/dashboard"}>
                      Start importing your data
                    </Link>{" "}
                    or check out <a href="https://webknossos.org/">webknossos.org</a> for some
                    published datasets.
                  </p>
                </React.Fragment>
              ) : (
                <PublicationView
                  datasets={this.state.datasets}
                  searchQuery={this.state.searchQuery}
                />
              )}
            </div>
          </Spin>
          {features().isDemoInstance ? <MissingDatasetCard /> : null}
          <div id="spotlight-footnote">
            Visit <a href="https://publication.webknossos.org/">publication.webknossos.org</a> for
            the original webKnossos publication website.
          </div>
        </Content>
        <CreditsFooter />
      </Layout>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(withRouter(SpotlightView));
