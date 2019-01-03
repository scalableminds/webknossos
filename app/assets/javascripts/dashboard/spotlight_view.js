// @flow
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { Spin, Layout, Button, Row, Col } from "antd";
import { connect } from "react-redux";
import * as React from "react";

import type { APIMaybeUnimportedDataset, APIUser } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { getOrganizations, getDatasets } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import GalleryDatasetView from "dashboard/gallery_dataset_view";
import features from "features";

const { Content, Footer } = Layout;

const SimpleHeader = () => (
  <div id="oxalis-header">
    <img src="/images/oxalis.svg" alt="webKnossos Logo" style={{ verticalAlign: "middle" }} />webKnossos
  </div>
);

const WelcomeHeader = ({ history }) => (
  <div
    style={{
      backgroundImage: "url(https://webknossos.org/images/nature-cover-compressed.jpg)",
    }}
  >
    <div style={{ backgroundColor: "rgba(88, 88, 88, 0.5)" }}>
      <div
        style={{
          maxWidth: 1300,
          textAlign: "center",
          margin: "auto",
          padding: "80px 0px",
        }}
      >
        <Row type="flex" align="middle" style={{ color: "white" }}>
          <Col span={4}>
            <img
              src="https://webknossos.brain.mpg.de/images/oxalis.svg"
              alt="webKnossos Logo"
              style={{ filter: "invert(1)", width: "100%" }}
            />
          </Col>
          <Col span={16}>
            <p style={{ fontSize: 58, textShadow: "0px 1px 6px #00000061" }}>
              Welcome to webKnossos
            </p>
            <p
              style={{
                fontSize: 20,
                textShadow: "0px 1px 6px #00000061",
                color: "rgb(245, 245, 245)",
                padding: "40px 60px",
              }}
            >
              webKnossos is an in-browser annotation tool for 3D electron microscopic data that
              facilitates user interaction with 3D image data. Together with ever better automated
              neuron segmentations, webKnossos can push connectomics to efficient large-scale
              reconstructions.
            </p>

            <div style={{ marginTop: 20 }}>
              <Button
                type="primary"
                size="large"
                style={{ marginRight: 50 }}
                onClick={() => history.push("/onboarding")}
              >
                Get Started
              </Button>
              <a
                href="https://docs.webknossos.org/"
                className="spotlight-hero-button"
                target="_blank"
                rel="noopener noreferrer"
              >
                Read the Documentation
              </a>
              <a
                href="https://support.webknossos.org/"
                target="_blank"
                className="spotlight-hero-button"
                rel="noopener noreferrer"
              >
                Join the Community
              </a>
              <a
                href="https://github.com/scalableminds/webknossos/"
                target="_blank"
                className="spotlight-hero-button"
                rel="noopener noreferrer"
              >
                Get the Code
              </a>
            </div>
          </Col>
        </Row>
      </div>
    </div>
  </div>
);

type StateProps = {
  activeUser: ?APIUser,
};

type Props = {
  history: RouterHistory,
} & StateProps;

type State = {
  datasets: Array<APIMaybeUnimportedDataset>,
  hasOrganizations: boolean,
  isLoading: boolean,
};

class SpotlightView extends React.PureComponent<Props, State> {
  state = {
    datasets: [],
    hasOrganizations: true,
    isLoading: true,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({ isLoading: true });
      const [datasets, organizations] = await Promise.all([getDatasets(), getOrganizations()]);
      this.setState({ datasets, hasOrganizations: organizations.length > 0 });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  render() {
    return (
      <Layout>
        {this.props.activeUser == null &&
        (features().allowOrganizationCreation || !this.state.hasOrganizations) ? (
          <WelcomeHeader history={this.props.history} />
        ) : (
          <SimpleHeader />
        )}
        <Content style={{ padding: 50 }}>
          <Spin size="large" spinning={this.state.isLoading}>
            <div style={{ minHeight: "100px" }}>
              {this.state.datasets.length === 0 && !this.state.isLoading ? (
                <p style={{ textAlign: "center" }}>
                  There are no datasets available yet.<br />Check out{" "}
                  <a href="https://demo.webknossos.org/">demo.webknossos.org</a> to see webKnossos
                  in action.
                </p>
              ) : (
                <GalleryDatasetView datasets={this.state.datasets} searchQuery="" />
              )}
            </div>
          </Spin>
          <div id="spotlight-footnote">
            Visit <a href="https://www.webknossos.org/">webknossos.org</a> to learn more about
            webKnossos.
          </div>
        </Content>
        <Footer style={{ backgroundColor: "#ececec" }}>
          <div id="credits">
            <div className="container">
              <h3>webKnossos Credits</h3>
              <p>
                Developed by{" "}
                <a href="https://www.brain.mpg.de/connectomics">
                  Max Planck Institute for Brain Research
                </a>{" "}
                and <a href="https://scalableminds.com">scalable minds</a>.
              </p>
              <p>
                <a href="https://www.brain.mpg.de/connectomics">
                  <img
                    className="img-responsive"
                    alt="Max Planck Gesellschaft logo"
                    src="/images/Max-Planck-Gesellschaft.svg"
                  />
                </a>
                <a href="https://www.brain.mpg.de/connectomics">
                  <img
                    className="img-responsive"
                    alt="Max Planck Institute for Brain Research logo"
                    src="/images/MPI-brain-research.svg"
                  />
                </a>
                <a href="https://scalableminds.com">
                  <img
                    className="img-responsive"
                    alt="scalable minds logo"
                    src="/images/scalableminds_logo.svg"
                    style={{ filter: "contrast(0)" }}
                  />
                </a>
              </p>
              <p>
                webKnossos has been published in: Boergens Berning Bocklisch Bräunlein Drawitsch
                Frohnhofen Herold Otto Rzepka Werkmeister Werner Wiese Wissler & Helmstaedter,
                webKnossos: efficient online 3D data annotation for connectomics.{" "}
                <a href="https://dx.doi.org/10.1038/nmeth.4331">Nat. Meth. (2017) 14, 691–694</a>.
              </p>
              <p>
                The webKnossos frontend was inspired by Knossos: Helmstaedter, M., K.L. Briggman,
                and W. Denk, High-accuracy neurite reconstruction for high-throughput neuroanatomy.{" "}
                <a href="https://dx.doi.org/10.1038/nn.2868">Nat. Neurosci. (2011) 14, 1081-1088</a>.
              </p>
              <p>
                More information about webKnossos and full credits at{" "}
                <a href="https://webknossos.org">webknossos.org</a>.
              </p>
              <p>
                <Link to="/imprint">Imprint</Link> &bull; <Link to="/privacy">Privacy</Link>
              </p>
            </div>
          </div>
        </Footer>
      </Layout>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(withRouter(SpotlightView));
