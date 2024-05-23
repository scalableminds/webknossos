import _ from "lodash";
import React, { useEffect, useState } from "react";
import { SyncOutlined } from "@ant-design/icons";
import { Table, Button } from "antd";
import { getAiModels } from "admin/admin_rest_api";
import Toast from "libs/toast";
import { AiModel } from "types/api_flow_types";
import FormattedDate from "components/formatted_date";
import { formatUserName } from "oxalis/model/accessors/user_accessor";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import { JobState } from "admin/job/job_list_view";

export default function AiModelListView() {
  const [isLoading, setIsLoading] = useState(false);
  const [aiModels, setAiModels] = useState<Array<AiModel>>([]);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);

  async function loadData() {
    setIsLoading(true);
    try {
      const _aiModels = await getAiModels();
      setAiModels(_aiModels);
    } catch (err) {
      console.error(err);
      Toast.error("Could not load model list.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="container voxelytics-view">
      <div className="pull-right">
        <Button onClick={() => loadData()}>
          <SyncOutlined spin={isLoading} /> Refresh
        </Button>
      </div>
      <h3>AI Models</h3>
      <Table
        bordered
        rowKey={(run: AiModel) => `${run.id}`}
        pagination={{ pageSize: 100 }}
        columns={[
          {
            title: "Name",
            dataIndex: "name",
            key: "name",
          },
          {
            title: "Created at",
            key: "created",
            defaultSortOrder: "descend",
            sorter: (a: AiModel, b: AiModel) => a.created - b.created,
            render: (model: AiModel) => <FormattedDate timestamp={model.created} />,
          },
          {
            title: "User",
            dataIndex: "user",
            key: "user",
            render: (user: AiModel["user"]) => formatUserName(activeUser, user),
            filters: _.uniq(aiModels.map((model) => formatUserName(null, model.user))).map(
              (username) => ({
                text: username,
                value: username,
              }),
            ),
            onFilter: (value: string | number | boolean, model: AiModel) =>
              formatUserName(null, model.user).startsWith(String(value)),
            filterSearch: true,
          },
          {
            title: "Status",
            dataIndex: "trainingJob",
            key: "status",
            render: (trainingJob: AiModel["trainingJob"]) =>
              trainingJob && <JobState job={trainingJob} />,
          },
          {
            title: "Comment",
            dataIndex: "comment",
            key: "comment",
          },
          {
            title: "",
            render: (_model: AiModel) => "TODO",
            key: "actions",
          },
        ]}
        dataSource={aiModels}
      />
    </div>
  );
}
