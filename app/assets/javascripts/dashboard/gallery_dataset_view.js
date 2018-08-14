// @flow
/* eslint-disable jsx-a11y/href-no-hash */
import * as React from "react";
import { connect } from "react-redux";
import { Modal } from "antd";
import * as Utils from "libs/utils";
import messages from "messages";
import { createExplorational, getOrganizations } from "admin/admin_rest_api";
import DatasetPanel from "dashboard/dataset_panel";
import _ from "lodash";

import type { OxalisState } from "oxalis/store";
import type { APIDatasetType, APIUserType } from "admin/api_flow_types";

type State = {
  organizationNameMap: { [key: string]: string },
};

type StateProps = {
  activeUser: ?APIUserType,
};

type Props = {
  datasets: Array<APIDatasetType>,
  searchQuery: string,
} & StateProps;

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

  createTracing = async (
    dataset: APIDatasetType,
    typ: "volume" | "skeleton",
    withFallback: boolean,
  ) => {
    if (this.props.activeUser == null) {
      Modal.confirm({
        content: messages["dataset.confirm_signup"],
        onOk: () => {
          window.location.href = "/auth/register";
        },
      });
    } else {
      const annotation = await createExplorational(dataset.name, typ, withFallback);
      window.location.href = `/annotations/${annotation.typ}/${annotation.id}`;
    }
  };

  render() {
    const filteredDatasets = Utils.filterWithSearchQueryAND(
      this.props.datasets.filter(ds => ds.isActive),
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

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(GalleryDatasetView);
