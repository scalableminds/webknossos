// @flow
import * as React from "react";
import _ from "lodash";

import type { APIDataset, APIMaybeUnimportedDataset } from "admin/api_flow_types";
import { getOrganizations } from "admin/admin_rest_api";
import DatasetPanel from "dashboard/dataset_panel";
import * as Utils from "libs/utils";

type State = {
  organizationNameMap: { [key: string]: string },
};

type Props = {
  datasets: Array<APIMaybeUnimportedDataset>,
  searchQuery: string,
};

const croppedDatasetCount = 6;

class GalleryDatasetView extends React.PureComponent<Props, State> {
  state = {
    organizationNameMap: {},
  };

  componentDidMount() {
    this.fetch();
  }

  async fetch() {
    const organizations = await getOrganizations();

    this.setState({
      organizationNameMap: _.mapValues(_.keyBy(organizations, "name"), org => org.displayName),
    });
  }

  render() {
    // $FlowFixMe flow doesn't check that after filtering there are only imported datasets left
    const activeDatasets: Array<APIDataset> = this.props.datasets.filter(ds => ds.isActive);
    const filteredDatasets = Utils.filterWithSearchQueryAND(
      activeDatasets,
      ["name", "description"],
      this.props.searchQuery,
    );

    const groupedDatasets = _.chain(filteredDatasets)
      .groupBy("owningOrganization")
      .entries()
      .map(([organization, datasets]) =>
        // Sort each group of datasets
        [
          organization,
          datasets.sort(Utils.compareBy(([]: APIDataset[]), dataset => dataset.sortingKey, false)),
        ],
      )
      .value()
      .sort(
        // Sort groups by creation date of first dataset
        Utils.compareBy(
          ([]: Array<[string, Array<APIDataset>]>),
          ([_organization, datasets]) => datasets[0].sortingKey,
          false,
        ),
      );

    const hasMultipleOrganizations = groupedDatasets.length > 1;
    return (
      <React.Fragment>
        {groupedDatasets.map(([organization, datasets]) => (
          <DatasetPanel
            showOrganizationHeader={hasMultipleOrganizations}
            croppedDatasetCount={croppedDatasetCount}
            className="dataset-panel"
            key={organization}
            organizationName={this.state.organizationNameMap[organization] || organization}
            datasets={datasets}
          />
        ))}
      </React.Fragment>
    );
  }
}

export default GalleryDatasetView;
