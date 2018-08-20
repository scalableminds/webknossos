// @flow
import * as React from "react";
import * as Utils from "libs/utils";
import { getOrganizations } from "admin/admin_rest_api";
import DatasetPanel from "dashboard/dataset_panel";
import _ from "lodash";
import type { APIDatasetType, APIMaybeUnimportedDatasetType } from "admin/api_flow_types";

type State = {
  organizationNameMap: { [key: string]: string },
};

type Props = {
  datasets: Array<APIMaybeUnimportedDatasetType>,
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
    const activeDatasets: Array<APIDatasetType> = this.props.datasets.filter(ds => ds.isActive);
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
          datasets.sort(Utils.compareBy(([]: APIDatasetType[]), dataset => dataset.created, false)),
        ],
      )
      .value()
      .sort(
        // Sort groups by creation date of first dataset
        Utils.compareBy(
          ([]: Array<[string, Array<APIDatasetType>]>),
          ([_organization, datasets]) => datasets[0].created,
          false,
        ),
      );

    const hasMultipleOrganizations = groupedDatasets.length > 1;
    return (
      <React.Fragment>
        {groupedDatasets.map(([organization, datasets]) => (
          <DatasetPanel
            showOrganizationHeader={hasMultipleOrganizations}
            croppedDatasetCount={hasMultipleOrganizations ? croppedDatasetCount : null}
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
