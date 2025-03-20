import { getDatasetAccessList } from "admin/admin_rest_api";
import { Spin, Tag } from "antd";
import { handleGenericError } from "libs/error_handling";
import { stringToColor } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import * as React from "react";
import type { APIDataset, APIUser } from "types/api_flow_types";

type Props = {
  dataset: APIDataset;
};

const DatasetAccessListView = ({ dataset }: Props) => {
  const [isLoading, setIsLoading] = React.useState(false);

  const datasetUsers = useFetch(
    () => {
      try {
        setIsLoading(true);
        return getDatasetAccessList(dataset);
      } catch (error) {
        handleGenericError(error as Error);
        return Promise.resolve([]);
      } finally {
        setIsLoading(false);
      }
    },
    [],
    [],
  );

  function renderUserTags(user: APIUser): React.ReactNode[] {
    if (user.isAdmin) {
      return [
        <Tag key={`team_role_${user.id}`} color="red">
          Admin
        </Tag>,
      ];
    } else {
      const managerTags = user.isDatasetManager
        ? [
            <Tag key={`dataset_manager_${user.id}`} color="geekblue">
              Dataset Manager
            </Tag>,
          ]
        : [];
      const teamTags = user.teams.map((team) => (
        <Tag color={stringToColor(team.name)} key={`${user.id}-${team.id}`}>
          {team.name}
        </Tag>
      ));
      return managerTags.concat(teamTags);
    }
  }

  function renderTable() {
    return (
      <div>
        <ul>
          {datasetUsers.map((user: APIUser) => (
            <li key={user.id}>
              <div
                style={{
                  width: 150,
                  display: "inline-block",
                }}
              >
                {user.firstName} {user.lastName}
              </div>
              {renderUserTags(user)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <Spin size="large" spinning={isLoading}>
      {renderTable()}
    </Spin>
  );
};

export default DatasetAccessListView;
