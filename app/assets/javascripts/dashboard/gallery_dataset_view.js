// @flow
/* eslint-disable jsx-a11y/href-no-hash */
import * as React from "react";
import { connect } from "react-redux";
import { Modal } from "antd";
import Utils from "libs/utils";
import messages from "messages";
import { createExplorational } from "admin/admin_rest_api";
import DatasetPanel from "dashboard/dataset_panel";

import type { DatasetType } from "dashboard/dataset_view";
import type { OxalisState } from "oxalis/store";
import type { APIUserType } from "admin/api_flow_types";

type StateProps = {
  activeUser: ?APIUserType,
};

type Props = {
  datasets: Array<DatasetType>,
  searchQuery: string,
} & StateProps;

class GalleryDatasetView extends React.PureComponent<Props> {
  createTracing = async (
    dataset: DatasetType,
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

  sortByOrganisation(datasets: DatasetType[]) {
    const sortedDatasets = [];
    for (let pos = 0; pos < datasets.length; pos++) {
      const dataset = datasets[pos];
      let found = false;
      for (let bucket = 0; bucket < sortedDatasets.length && !found; bucket++) {
        if (sortedDatasets[bucket].owningOrganization === dataset.owningOrganization) {
          sortedDatasets[bucket].datasets.push(dataset);
          found = true;
        }
      }
      if (!found) {
        const datasetArray = [dataset];
        const organisationWithDatasets = {
          owningOrganization: dataset.owningOrganization,
          datasets: datasetArray,
        };
        sortedDatasets.push(organisationWithDatasets);
      }
    }
    return sortedDatasets;
  }

  render() {
    const datasets = Utils.filterWithSearchQueryAND(
      this.props.datasets.filter(ds => ds.isActive),
      ["name", "description"],
      this.props.searchQuery,
    ).sort(Utils.localeCompareBy("formattedCreated", false));
    const sortedDatasets = this.sortByOrganisation(datasets);
    return (
      <React.Fragment>
        {sortedDatasets.map(ds => (
          <DatasetPanel
            className="dataset-panel"
            key={ds.owningOrganization}
            owningOrganization={ds.owningOrganization}
            datasets={ds.datasets}
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
