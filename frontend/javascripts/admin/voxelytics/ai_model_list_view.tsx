import _ from "lodash";
import React, { useState } from "react";
import { SyncOutlined } from "@ant-design/icons";
import { Table, Button, Modal } from "antd";
import { getAiModels } from "admin/admin_rest_api";
import type { AiModel } from "types/api_flow_types";
import FormattedDate from "components/formatted_date";
import { formatUserName } from "oxalis/model/accessors/user_accessor";
import { useSelector } from "react-redux";
import type { OxalisState } from "oxalis/store";
import { JobState } from "admin/job/job_list_view";
import { Link } from "react-router-dom";
import { useGuardedFetch } from "libs/react_helpers";
import { PageNotAvailableToNormalUser } from "components/permission_enforcer";
import type { Key } from "react";

export default function AiModelListView() {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [aiModels, isLoading] = useGuardedFetch(
    getAiModels,
    [],
    [refreshCounter],
    "Could not load model list.",
  );

  if (!activeUser?.isSuperUser) {
    return <PageNotAvailableToNormalUser />;
  }

  return (
    <div className="container voxelytics-view">
      <div className="pull-right">
        <Button onClick={() => setRefreshCounter((val) => val + 1)}>
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
            onFilter: (value: Key | boolean, model: AiModel) =>
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
            title: "Actions",
            render: renderActionsForModel,
            key: "actions",
          },
        ]}
        dataSource={aiModels}
      />
    </div>
  );
}

const renderActionsForModel = (model: AiModel) => {
  if (model.trainingJob == null) {
    return;
  }
  const { voxelyticsWorkflowHash, trainingAnnotations } = model.trainingJob;

  return (
    <div>
      {voxelyticsWorkflowHash != null ? (
        <>
          <Link to={`/workflows/${voxelyticsWorkflowHash}`}>Voxelytics Report</Link>
          <br />
        </>
      ) : null}
      {trainingAnnotations == null ? null : trainingAnnotations.length > 1 ? (
        <a
          href="#"
          onClick={() => {
            Modal.info({
              content: (
                <div>
                  The following annotations were used during training:
                  <ul>
                    {trainingAnnotations.map(
                      (annotation: { annotationId: string }, index: number) => (
                        <li key={`annotation_${index}`}>
                          <a
                            href={`/annotations/${annotation.annotationId}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Annotation {index + 1}
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ),
            });
          }}
        >
          Show Training Data
        </a>
      ) : (
        <a
          href={`/annotations/${trainingAnnotations[0].annotationId}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Show Training Data
        </a>
      )}
    </div>
  );
};
