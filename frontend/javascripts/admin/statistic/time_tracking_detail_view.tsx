import { useFetch } from "libs/react_helpers";
import React from "react";
import { AnnotationTypeFilterEnum } from "./project_and_annotation_type_dropdown";
import { getTimeTrackingForUserSummedPerAnnotation } from "admin/admin_rest_api";
import dayjs from "dayjs";
import { Table } from "antd";
import { formatMilliseconds } from "libs/format_utils";
import { render } from "react-dom";
import _ from "lodash";
const { Column } = Table;

type TimeTrackingDetailViewProps = {
    userId: string;
    dateRange: [number, number];
    annotationType: AnnotationTypeFilterEnum;
    projectIds: string[];
};

const renderRow = (userDataPerAnnotation) => {
    if (userDataPerAnnotation == null) return;
    const groupedByProject = _.groupBy(userDataPerAnnotation, "projectName");
    let taskRows = [];
    let annotationRows = [];
    for (const [project, loggedTimes] of Object.entries(groupedByProject)) {
        if (project === "null") {
            const tableRows = loggedTimes.map((timeEntry) => (
                <tr>
                    <td>Annotation: {timeEntry.annotation}</td>
                    <td>{formatMilliseconds(timeEntry.timeMillis)}</td>
                </tr>
            ));
            annotationRows = annotationRows.concat(tableRows);
        } else {
            taskRows.push(
                <tr>
                    <td>{project}</td>
                </tr>,
            );
            const tableRows = loggedTimes.map((timeEntry) => (
                <tr>
                    <td>Task: {timeEntry.task}</td>
                    <td>{formatMilliseconds(timeEntry.timeMillis)}</td>
                </tr>
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
        [],
    );

    const [annotationRows, taskRows] = renderRow(userData);
    return (
        <table>
            <tbody>
                {annotationRows}
                {taskRows}
            </tbody>
        </table>
    );
}

export default TimeTrackingDetailView;
