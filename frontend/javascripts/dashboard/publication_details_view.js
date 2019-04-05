// @flow
import * as React from "react";
import { Layout, Icon, Spin, Tooltip } from "antd";

import { getDatasets } from "admin/admin_rest_api";
import type { APIDataset, APIMaybeUnimportedDataset } from "admin/api_flow_types";
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
    const activeDatasets: Array<APIDataset> = ((datasets.filter(
      ds => ds.isActive,
    ): any): Array<APIDataset>);
    const theChosenDatasets = activeDatasets.filter(
      ds => ds.publication != null && ds.publication.id === this.props.publicationId,
    );
    return (
      <Layout>
        <SimpleHeader />
        <Content className="centered-content">
          <Spin size="large" spinning={isLoading}>
            {theChosenDatasets.length > 0 ? (
              <React.Fragment>
                <Link to="/">
                  <Tooltip title="Back to the frontpage.">
                    <Icon
                      type="arrow-left"
                      style={{ fontSize: 24, color: "rgba(0, 0, 0, 0.85)", marginBottom: 18 }}
                    />
                  </Tooltip>
                </Link>
                Back
                <PublicationCard
                  className="dataset-panel"
                  datasets={theChosenDatasets}
                  showDetailedLink={false}
                />
              </React.Fragment>
            ) : null}
            {!isLoading && theChosenDatasets.length === 0 ? (
              <p style={{ textAlign: "center" }}>There are not datasets for this publication.</p>
            ) : null}
          </Spin>
        </Content>
      </Layout>
    );
  }
}

export default PublicationDetailView;
