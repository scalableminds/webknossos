// @flow
import * as React from "react";
import _ from "lodash";
import { List } from "antd";

import type { APIDataset, APIMaybeUnimportedDataset } from "admin/api_flow_types";
import PublicationCard from "dashboard/publication_card";
import * as Utils from "libs/utils";

const gridValues = {
  gutter: 24,
  xs: 1,
  sm: 1,
  md: 1,
  lg: 1,
  xl: 2,
  xxl: 2,
};

type Props = {
  datasets: Array<APIMaybeUnimportedDataset>,
  searchQuery: string,
};

class PublicationView extends React.PureComponent<Props> {
  render() {
    // $FlowFixMe flow doesn't check that after filtering there are only imported datasets left
    const activeDatasets: Array<APIDataset> = this.props.datasets.filter(ds => ds.isActive);
    const filteredDatasets = Utils.filterWithSearchQueryAND(
      activeDatasets,
      ["name", "description", "details"],
      this.props.searchQuery,
    );

    const datasetsByPublication = _.chain(filteredDatasets)
      .filter(dataset => dataset.publication != null)
      .groupBy("publication.id")
      .values()
      .sort(
        // Sort publication groups by publication creation date
        Utils.compareBy(
          ([]: Array<APIDataset>),
          datasets => datasets[0].publication.publicationDate,
          false,
        ),
      );

    return (
      <React.Fragment>
        <List
          grid={gridValues}
          dataSource={datasetsByPublication}
          renderItem={datasets => (
            <List.Item key={datasets[0].publication.id}>
              <PublicationCard className="dataset-panel" datasets={datasets} />
            </List.Item>
          )}
        />
      </React.Fragment>
    );
  }
}

export default PublicationView;
