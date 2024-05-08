import { useFetch } from "libs/react_helpers";
import React from "react";
import { AnnotationTypeFilterEnum } from "./project_and_annotation_type_dropdown";
import { getTimeTrackingForUserSummedPerAnnotation } from "admin/admin_rest_api";
import dayjs from "dayjs";
import { Col, Divider, Row } from "antd";
import { formatMilliseconds } from "libs/format_utils";
import _ from "lodash";
import { APITimeTrackingPerAnnotation } from "types/api_flow_types";
import { AnnotationStats } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import { aggregateStatsForAllLayers } from "oxalis/model/accessors/annotation_accessor";

type TimeTrackingDetailViewProps = {
  userId: string;
  dateRange: [number, number];
  annotationType: AnnotationTypeFilterEnum;
  projectIds: string[];
};

const ANNOTATION_OR_TASK_NAME_SPAN = 16;
const STATISTICS_SPAN = 4;
const TIMESPAN_SPAN = 4;

const STYLING_CLASS_NAME = "time-tracking-details";

const renderRow = (
  userDataPerAnnotation: APITimeTrackingPerAnnotation[],
): [Array<JSX.Element>, Array<JSX.Element>] => {
  if (userDataPerAnnotation == null) return [[], []];
  const groupedByProject = _.groupBy(userDataPerAnnotation, "projectName");
  let taskRows: Array<JSX.Element> = [];
  let annotationRows: Array<JSX.Element> = [];
  for (const [project, loggedTimes] of Object.entries(groupedByProject)) {
    if (project === "null") {
      // explorative annotations
      const tableRows = loggedTimes.map((timeEntry) => (
        <Row>
          <Col span={ANNOTATION_OR_TASK_NAME_SPAN}>
            <a href={`annotations/${timeEntry.annotation}`}>Annotation: {timeEntry.annotation} </a>
          </Col>
          <Col span={STATISTICS_SPAN}>
            <AnnotationStats
              stats={aggregateStatsForAllLayers(timeEntry.annotationLayerStats)}
              asInfoBlock={false}
              withMargin={false}
            />
          </Col>
          <Col span={TIMESPAN_SPAN}>{formatMilliseconds(timeEntry.timeMillis)}</Col>
        </Row>
      ));
      annotationRows = annotationRows.concat(tableRows);
    } else {
      // tasks
      taskRows.push(
        <Row style={{ fontWeight: "bold", margin: "5px 20px" }}>
          <Col>{project}</Col>
        </Row>,
      );
      const tableRows = loggedTimes.map((timeEntry) => (
        <Row>
          <Col span={ANNOTATION_OR_TASK_NAME_SPAN}>
            <a href={`annotations/${timeEntry.annotation}`}>Task: {timeEntry.task}</a>
          </Col>
          <Col span={STATISTICS_SPAN}>
            <AnnotationStats
              stats={aggregateStatsForAllLayers(timeEntry.annotationLayerStats)}
              asInfoBlock={false}
              withMargin={false}
            />
          </Col>
          <Col span={TIMESPAN_SPAN}>{formatMilliseconds(timeEntry.timeMillis)}</Col>
        </Row>
      ));
      taskRows = taskRows.concat(tableRows);
    }
  }
  return [annotationRows, taskRows];
};

function TimeTrackingDetailView(props: TimeTrackingDetailViewProps) {
  const userData = useFetch(
    async () => {
      return await getTimeTrackingForUserSummedPerAnnotation(
        props.userId,
        dayjs(props.dateRange[0]),
        dayjs(props.dateRange[1]),
        props.annotationType,
        props.projectIds,
      );
    },
    [],
    [props],
  );

  const [annotationRows, taskRows] = renderRow(userData);
  const rowsNoDivider = annotationRows.concat(taskRows);
  const rowLength = rowsNoDivider.length;
  const rows = rowsNoDivider.map((row, index) => {
    if (index < rowLength - 1)
      return (
        <>
          {row} <Divider style={{ margin: 0 }} />
        </>
      );
    return row;
  });
  return <div className={STYLING_CLASS_NAME}>{rows}</div>;
}

export default TimeTrackingDetailView;
