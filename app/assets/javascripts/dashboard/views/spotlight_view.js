// @flow
import * as React from "react";
import { Link } from "react-router-dom";
import { Spin, Layout, Row, Col } from "antd";
import { transformDatasets } from "dashboard/views/dataset_view";
import GalleryDatasetView from "dashboard/views/gallery_dataset_view";
import Request from "libs/request";
import type { DatasetType } from "dashboard/views/dataset_view";

const { Header, Content, Footer } = Layout;

type State = {
  datasets: Array<DatasetType>,
  isLoading: boolean,
};

class SpotlightView extends React.PureComponent<{}, State> {
  state = {
    datasets: [],
    isLoading: true,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const url = "/api/datasets";
    this.setState({ isLoading: true });
    const datasets = await Request.receiveJSON(url);

    const transformedDatasets = transformDatasets(datasets);
    this.setState({
      datasets: transformedDatasets,
      isLoading: false,
    });
  }

  render() {
    return (
      <Layout>
        <Header id="oxalis-header">
          <div>
            <img
              src="/assets/images/oxalis.svg"
              alt="webKnossos Logo"
              style={{ verticalAlign: "middle" }}
            />webKnossos
          </div>
        </Header>
        <Content style={{ padding: 50 }}>
          {this.state.isLoading ? (
            <Spin size="large" />
          ) : (
            <GalleryDatasetView datasets={this.state.datasets} searchQuery="" />
          )}
          <div id="spotlight-footnote">
            Visit <a href="https://www.webknossos.org/">webknossos.org</a> to learn more about
            webKnossos.
          </div>
        </Content>
        <Footer style={{ backgroundColor: "#ececec" }}>
          <div id="credits">
            <div className="container">
              <h3>webKnossos Credits</h3>
              <Row>
                <Col span={8}>
                  <h4>Max Planck Institute for Brain Research</h4>
                  <p>
                    Department of Connectomics<br />
                    <a href="http://www.brain.mpg.de/connectomics">
                      http://www.brain.mpg.de/connectomics
                    </a>
                  </p>
                  <ul>
                    <li>Moritz Helmstaedter</li>
                    <li>Manuel Berning</li>
                    <li>Kevin Boergens</li>
                    <li>Heiko Wissler</li>
                    <li>Alessandro Motta</li>
                  </ul>
                </Col>
                <Col span={8}>
                  <h4>scalable minds</h4>
                  <p>
                    <a href="http://scalableminds.com">http://scalableminds.com</a>
                  </p>
                  <ul>
                    <li>Tom Bocklisch</li>
                    <li>Dominic Bräunlein</li>
                    <li>Johannes Frohnhofen</li>
                    <li>Tom Herold</li>
                    <li>Florian Meinel</li>
                    <li>Philipp Otto</li>
                    <li>Norman Rzepka</li>
                    <li>Jonathan Striebel</li>
                    <li>Thomas Werkmeister</li>
                    <li>Daniel Werner</li>
                    <li>Georg Wiese</li>
                  </ul>
                </Col>
                <Col span={8}>
                  <a href="http://www.brain.mpg.de/connectomics">
                    <img
                      className="img-50"
                      alt="Max Planck Gesellschaft logo"
                      src="assets/images/Max-Planck-Gesellschaft.svg"
                    />
                  </a>
                  <a href="http://www.brain.mpg.de/connectomics">
                    <img
                      className="img-50"
                      alt="Max Planck Institute for Brain Research logo"
                      src="assets/images/MPI-brain-research.svg"
                    />
                  </a>
                  <a href="http://www.scm.io">
                    <img
                      className="img-responsive"
                      alt="scalable minds logo"
                      src="assets/images/scalableminds_logo.svg"
                      style={{ filter: "contrast(0)" }}
                    />
                  </a>
                </Col>
              </Row>
              <section>
                <p>
                  webKnossos is using Brainflight technology for real time data delivery,
                  implemented by <em>scalable minds</em>
                </p>
              </section>
              <section>
                <p>The webKnossos frontend was inspired by Knossos:</p>
                <p>
                  Helmstaedter, M., K.L. Briggman, and W. Denk,<br />
                  High-accuracy neurite reconstruction for high-throughput neuroanatomy. <br />
                  Nat. Neurosci. 14, 1081–1088, 2011.<br />
                  <a href="http://www.knossostool.org">http://www.knossostool.org</a>
                </p>
              </section>
              <section>
                <p>
                  For more information about our project, visit{" "}
                  <a href="http://www.brainflight.net">http://www.brainflight.net</a> and{" "}
                  <a href="http://www.brain.mpg.de/connectomics">
                    http://www.brain.mpg.de/connectomics
                  </a>
                </p>

                <p>&copy; Max Planck Institut for Brain Research</p>
              </section>
              <p>
                <Link to="/impressum">Legal Notice</Link>
              </p>
            </div>
          </div>
        </Footer>
      </Layout>
    );
  }
}

export default SpotlightView;
