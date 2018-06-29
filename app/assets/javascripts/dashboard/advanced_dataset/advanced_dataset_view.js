// @flow
/* eslint-disable jsx-a11y/href-no-hash, react/prefer-stateless-function */

import * as React from "react";
import TemplateHelpers from "libs/template_helpers";
import Utils from "libs/utils";
import { Table, Icon, Tag } from "antd";
import DatasetActionView from "dashboard/advanced_dataset/dataset_action_view";
import DatasetAccessListView from "dashboard/advanced_dataset/dataset_access_list_view";
import type { DatasetType } from "dashboard/dataset_view";
import type { APITeamType } from "admin/api_flow_types";

const { Column } = Table;

const typeHint: DatasetType[] = [];

type Props = {
  datasets: Array<DatasetType>,
  searchQuery: string,
};

class AdvancedDatasetView extends React.PureComponent<Props> {
  render() {
    return (
      <div className="TestAdvancedDatasetView">
        <Table
          dataSource={Utils.filterWithSearchQueryOR(
            this.props.datasets,
            ["name", "description"],
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
            sorter={Utils.localeCompareBy(typeHint, "name")}
            render={(name: string, dataset: DatasetType) => (
              <div>
                {dataset.name}
                <br />
                <Tag color={TemplateHelpers.stringToColor(dataset.dataStore.name)}>
                  {dataset.dataStore.name}
                </Tag>
              </div>
            )}
          />
          <Column
            width={150}
            title="Creation Date"
            dataIndex="created"
            key="created"
            defaultSortOrder="descend"
            sorter={Utils.localeCompareBy(typeHint, "formattedCreated")}
            render={(__, dataset: DatasetType) => dataset.formattedCreated}
          />
          <Column
            title="Scale"
            dataIndex="scale"
            key="scale"
            width={120}
            render={(__, dataset: DatasetType) =>
              TemplateHelpers.formatTuple(dataset.dataSource.scale)
            }
          />

          <Column
            title="Allowed Teams"
            dataIndex="allowedTeams"
            key="allowedTeams"
            width={150}
            render={(teams: Array<APITeamType>, dataset: DatasetType) =>
              teams.map(team => (
                <Tag
                  color={TemplateHelpers.stringToColor(team.name)}
                  key={`allowed_teams_${dataset.name}_${team.name}`}
                >
                  {team.name}
                </Tag>
              ))
            }
          />
          <Column
            title="Active"
            dataIndex="isActive"
            key="isActive"
            width={100}
            sorter={(a, b) => a.isActive - b.isActive}
            render={(isActive: boolean) => {
              const icon = isActive ? "check-circle-o" : "close-circle-o";
              return <Icon type={icon} style={{ fontSize: 20 }} />;
            }}
          />
          <Column
            title="Public"
            dataIndex="isPublic"
            key="isPublic"
            width={100}
            sorter={(a, b) => a.isPublic - b.isPublic}
            render={(isPublic: boolean) => {
              const icon = isPublic ? "check-circle-o" : "close-circle-o";
              return <Icon type={icon} style={{ fontSize: 20 }} />;
            }}
          />
          <Column
            title="Data Layers"
            dataIndex="dataSource.dataLayers"
            render={(__, dataset: DatasetType) =>
              (dataset.dataSource.dataLayers || []).map(layer => (
                <Tag key={layer.name}>
                  {layer.category} - {layer.elementClass}
                </Tag>
              ))
            }
          />

          <Column
            width={200}
            title="Actions"
            key="actions"
            render={(__, dataset: DatasetType) => <DatasetActionView dataset={dataset} />}
          />
        </Table>
      </div>
    );
  }
}

export default AdvancedDatasetView;
