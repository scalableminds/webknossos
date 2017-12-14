// @flow
/* eslint-disable jsx-a11y/href-no-hash, react/prefer-stateless-function */

import * as React from "react";
import TemplateHelpers from "libs/template_helpers";
import Utils from "libs/utils";
import { Table, Icon, Tag } from "antd";
import DatasetActionView from "dashboard/views/advanced_dataset/dataset_action_view";
import DatasetAccessListView from "dashboard/views/advanced_dataset/dataset_access_list_view";
import TeamAssignmentModal from "dashboard/views/dataset/team_assignment_modal";
import type { DatasetType } from "dashboard/views/dataset_view";

const { Column } = Table;

type Props = {
  datasets: Array<DatasetType>,
  searchQuery: string,
  updateDataset: DatasetType => void,
};

type State = {
  isTeamAssignmentModalVisible: boolean,
  selectedDataset: ?DatasetType,
};

class AdvancedDatasetView extends React.PureComponent<Props, State> {
  state = {
    isTeamAssignmentModalVisible: false,
    selectedDataset: null,
  };

  render() {
    return (
      <div className="TestAdvancedDatasetView">
        <Table
          dataSource={Utils.filterWithSearchQueryOR(
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
            width={110}
            title="Creation Date"
            dataIndex="created"
            key="created"
            sorter={Utils.localeCompareBy("formattedCreated")}
            render={(__, dataset: DatasetType) => dataset.formattedCreated}
          />
          <Column
            title="Scale"
            dataIndex="scale"
            key="scale"
            render={(__, dataset: DatasetType) =>
              TemplateHelpers.formatTuple(dataset.dataSource.scale)
            }
          />

          <Column
            title="Allowed Teams"
            dataIndex="allowedTeams"
            key="allowedTeams"
            width={150}
            render={(teams: Array<string>, dataset: DatasetType) =>
              teams.map(team => (
                <Tag
                  color={TemplateHelpers.stringToColor(team)}
                  key={`allowed_teams_${dataset.name}_${team}`}
                  onClick={() =>
                    this.setState({
                      selectedDataset: dataset,
                      isTeamAssignmentModalVisible: true,
                    })
                  }
                >
                  {team === dataset.owningTeam ? <i className="fa fa-lock" /> : null}
                  {team}
                </Tag>
              ))
            }
          />
          <Column
            title="Active"
            dataIndex="isActive"
            key="isActive"
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
        {this.state.isTeamAssignmentModalVisible && this.state.selectedDataset ? (
          <TeamAssignmentModal
            isVisible={this.state.isTeamAssignmentModalVisible}
            dataset={this.state.selectedDataset}
            onCancel={() =>
              this.setState({
                isTeamAssignmentModalVisible: false,
              })
            }
            onOk={(updatedDataset: DatasetType) => {
              this.props.updateDataset(updatedDataset);
              this.setState({
                isTeamAssignmentModalVisible: false,
              });
            }}
          />
        ) : null}
      </div>
    );
  }
}

export default AdvancedDatasetView;
