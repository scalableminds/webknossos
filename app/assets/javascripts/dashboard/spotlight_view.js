// @flow
import * as React from "react";
import { Link } from "react-router-dom";
import { Spin, Layout, Row, Col } from "antd";
import { transformDatasets } from "dashboard/dataset_view";
import GalleryDatasetView from "dashboard/gallery_dataset_view";
import type { DatasetType } from "dashboard/dataset_view";
import { getDatasets } from "admin/admin_rest_api";

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
    this.setState({ isLoading: true });
    const datasets = await getDatasets();

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
                    className="img-50"
                    alt="Max Planck Gesellschaft logo"
                    src="assets/images/Max-Planck-Gesellschaft.svg"
                  />
                </a>
                <a href="https://www.brain.mpg.de/connectomics">
                  <img
                    className="img-50"
                    alt="Max Planck Institute for Brain Research logo"
                    src="assets/images/MPI-brain-research.svg"
                  />
                </a>
                <a href="https://scalableminds.com">
                  <img
                    className="img-responsive"
                    alt="scalable minds logo"
                    src="assets/images/scalableminds_logo.svg"
                    style={{ filter: "contrast(0)" }}
                  />
                </a>
              </p>
              <p>
                webKnossos has been published in:{" "}
                <a href="http://dx.doi.org/10.1038/NMETH.4331">
                  Boergens Berning Bocklisch Bräunlein Drawitsch Frohnhofen Herold Otto Rzepka
                  Werkmeister Werner Wiese Wissler & Helmstaedter, webKnossos: efficient online 3D
                  data annotation for connectomics,. Nat. Meth. (2017) DOI:10.1038/NMETH.4331
                </a>.
              </p>
              <p>
                The webKnossos frontend was inspired by Knossos:{" "}
                <a href="">
                  Helmstaedter, M., K.L. Briggman, and W. Denk, Nat. Neurosci. (2011) 14, 1081-1088
                </a>.
              </p>
              <p>
                <a href="https://webknossos.org">
                  More information about webKnossos and full credits at webknossos.org
                </a>.
              </p>
              <p>
                <Link to="/imprint">Imprint</Link> &bull;
                <Link to="/privacy">Privacy</Link>
              </p>
            </div>
          </div>
        </Footer>
      </Layout>
    );
  }
}

export default SpotlightView;
