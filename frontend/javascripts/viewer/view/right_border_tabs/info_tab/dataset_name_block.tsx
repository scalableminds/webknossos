import { SettingOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import Markdown from "libs/markdown_adapter";
import { useWkSelector } from "libs/react_hooks";
import { mayUserEditDataset } from "libs/utils";
import { Link } from "react-router";
import { getReadableURLPart, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import { DatasetAnnotationCountLink } from "./dataset_annotation_count_link";

export function DatasetNameBlock({ isDatasetViewMode }: { isDatasetViewMode: boolean }) {
  const dataset = useWkSelector((state) => state.dataset);
  const activeUser = useWkSelector((state) => state.activeUser);
  const { name: datasetName, description: datasetDescription } = dataset;

  const editSettingsIcon = mayUserEditDataset(activeUser, dataset) ? (
    <FastTooltip title="Edit dataset settings">
      <Link to={`/datasets/${getReadableURLPart(dataset)}/edit`} style={{ paddingLeft: 3 }}>
        <Typography.Text type="secondary">
          <SettingOutlined />
        </Typography.Text>
      </Link>
    </FastTooltip>
  ) : null;

  if (isDatasetViewMode) {
    return (
      <div className="info-tab-block">
        <div
          style={{
            wordWrap: "break-word",
            padding: "5px 0",
          }}
        >
          <Typography.Title level={5} style={{ display: "initial", paddingRight: "5px" }}>
            {datasetName}
          </Typography.Title>
          {editSettingsIcon}
        </div>
        {datasetDescription ? (
          <div
            style={{
              fontSize: 14,
            }}
          >
            <Markdown>{datasetDescription}</Markdown>
          </div>
        ) : null}
        <DatasetAnnotationCountLink dataset={dataset} />
      </div>
    );
  }

  return (
    <div className="info-tab-block">
      <p className="sidebar-label">Dataset {editSettingsIcon}</p>
      <Link
        to={getViewDatasetURL(dataset)}
        title={`Click to view dataset ${datasetName} without annotation`}
        style={{
          wordWrap: "break-word",
        }}
      >
        {datasetName}
      </Link>
    </div>
  );
}
