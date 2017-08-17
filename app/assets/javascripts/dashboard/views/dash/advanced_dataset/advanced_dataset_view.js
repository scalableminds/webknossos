// @flow
/* eslint-disable jsx-a11y/href-no-hash, react/prefer-stateless-function */

import React from "react";
import TemplateHelpers from "libs/template_helpers";
import type { APIUserType, APIDatasetType } from "admin/api_flow_types";
import Utils from "libs/utils";
import { Table, Icon, Tag } from "antd";
import DatasetActionView from "./dataset_action_view";
import DatasetAccessListView from "./dataset_access_list_view";

const { Column } = Table;

type Props = {
  datasets: Array<APIDatasetType>,
  searchQuery: string,
};

class AdvancedDatasetView extends React.PureComponent {
  props: Props;

  render() {
    return (
      <div>
        <Table
          dataSource={Utils.filterWithSearchQuery(
            this.props.datasets,
            ["name", "owningTeam", "description"],
            this.props.searchQuery,
          )}
          rowKey="name"
          pagination={{
            defaultPageSize: 50,
          }}
          expandedRowRender={dataset => <DatasetAccessListView dataset={dataset} />}
        >
          <Column
            title="Name"
            dataIndex="name"
            key="name"
            sorter={Utils.localeCompareBy("name")}
            render={(name, dataset: APIDatasetType) =>
              <div title={dataset.dataSource.baseDir}>
                {dataset.name}
                <br />
                <Tag color={TemplateHelpers.stringToColor(dataset.dataStore.name)}>
                  {dataset.dataStore.name}
                </Tag>
              </div>}
          />
          <Column
            title="Creation Date"
            dataIndex="created"
            key="created"
            sorter={Utils.localeCompareBy("formattedCreated")}
            render={(__, dataset: APIDatasetType) => dataset.formattedCreated}
          />
          <Column
            title="Scale"
            dataIndex="scale"
            key="scale"
            render={(__, dataset: APIDatasetType) =>
              TemplateHelpers.formatTuple(dataset.dataSource.scale)}
          />

          <Column
            title="Allowed Teams"
            dataIndex="allowedTeams"
            key="allowedTeams"
            render={(teams, dataset: APIDatasetType) =>
              teams.map(team =>
                <Tag
                  color={TemplateHelpers.stringToColor(team)}
                  key={`allowed_teams_${dataset.name}_${team}`}
                >
                  {team === dataset.owningTeam ? <i className="fa fa-lock" /> : null}
                  {team}
                </Tag>,
              )}
          />
          <Column
            title="Active"
            dataIndex="isActive"
            key="isActive"
            sorter={(a, b) => a.isActive - b.isActive}
            render={isActive => {
              const icon = isActive ? "check-circle-o" : "close-circle-o";
              return <Icon type={icon} style={{ fontSize: 20 }} />;
            }}
          />
          <Column
            title="Public"
            dataIndex="isPublic"
            key="isPublic"
            sorter={(a, b) => a.isPublic - b.isPublic}
            render={isPublic => {
              const icon = isPublic ? "check-circle-o" : "close-circle-o";
              return <Icon type={icon} style={{ fontSize: 20 }} />;
            }}
          />
          <Column
            title="Data Layers"
            dataIndex="dataSource.dataLayers"
            render={(__, dataset) =>
              (dataset.dataSource.dataLayers || []).map(layer =>
                <Tag key={`${layer.category} - ${layer.elementClass}`}>
                  {layer.category} - {layer.elementClass}
                </Tag>,
              )}
          />

          <Column
            width={200}
            title="Actions"
            key="actions"
            render={(__, dataset: APIUserType) => <DatasetActionView dataset={dataset} />}
          />
        </Table>
      </div>
    );
  }
}

export default AdvancedDatasetView;
