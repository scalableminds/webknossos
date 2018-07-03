// @flow
/* eslint-disable jsx-a11y/href-no-hash */
import * as React from "react";
import { connect } from "react-redux";
import { Modal } from "antd";
import Utils from "libs/utils";
import messages from "messages";
import { createExplorational } from "admin/admin_rest_api";
import DatasetPanel from "dashboard/dataset_panel";
import _ from "lodash";

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

  render() {
    const datasets = Utils.filterWithSearchQueryAND(
      this.props.datasets.filter(ds => ds.isActive),
      ["name", "description"],
      this.props.searchQuery,
    );

    const groupedDatasets = _.chain(datasets)
      .groupBy("owningOrganization")
      .entries()
      .map(([organization, datasets]) => {
        // Sort each group of datasets
        return [
          organization,
          datasets.sort(Utils.localeCompareBy(([]: DatasetType[]), "formattedCreated", false)),
        ];
      })
      .value()
      .sort(
        // Sort groups by creation date of first dataset
        Utils.localeCompareBy(
          ([]: DatasetType[]),
          ([organization, datasets]) => datasets[0].formattedCreated,
          false,
        ),
      );

    const hasMultipleOrganizations = groupedDatasets.length > 1;
    return (
      <React.Fragment>
        {groupedDatasets.map(([organization, datasets]) => (
          <DatasetPanel
            showOrganizationHeader={hasMultipleOrganizations}
            className="dataset-panel"
            key={organization}
            owningOrganization={organization}
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
