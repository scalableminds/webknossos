// @flow
import * as React from "react";
import { Layout, Spin, Tooltip } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";

import { getDatasets } from "admin/admin_rest_api";
import type { APIDataset, APIMaybeUnimportedDataset } from "types/api_flow_types";
import PublicationCard from "dashboard/publication_card";
import { handleGenericError } from "libs/error_handling";
import { SimpleHeader } from "dashboard/spotlight_view";
import { Link } from "react-router-dom";

const { Content } = Layout;

type Props = {
  publicationId: string,
};

type State = {
  datasets: Array<APIMaybeUnimportedDataset>,
  isLoading: boolean,
};

class PublicationDetailView extends React.PureComponent<Props, State> {
  state = {
    datasets: [],
    isLoading: true,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({ isLoading: true });
      const datasets = await getDatasets();
      this.setState({ datasets });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  render() {
    const { isLoading, datasets } = this.state;
    const datasetsOfPublication = ((datasets.filter(
      ds => ds.isActive && ds.publication != null && ds.publication.id === this.props.publicationId,
    ): any): Array<APIDataset>);
    return (
      <Layout>
        <SimpleHeader />
        <Content className="centered-content">
          <Spin size="large" spinning={isLoading}>
            {datasetsOfPublication.length > 0 ? (
              <React.Fragment>
                <Link to="/">
                  <Tooltip title="Back to the frontpage.">
                    <ArrowLeftOutlined style={{ fontSize: 24, color: "#555", marginBottom: 18 }} />
                  </Tooltip>
                </Link>
                <div style={{ display: "inline-block", verticalAlign: "top" }}>Back</div>
                <PublicationCard
                  className="dataset-panel"
                  datasets={datasetsOfPublication}
                  showDetailedLink={false}
                />
              </React.Fragment>
            ) : null}
            {!isLoading && datasetsOfPublication.length === 0 ? (
              <p style={{ textAlign: "center" }}>There are not datasets for this publication.</p>
            ) : null}
          </Spin>
        </Content>
      </Layout>
    );
  }
}

export default PublicationDetailView;
