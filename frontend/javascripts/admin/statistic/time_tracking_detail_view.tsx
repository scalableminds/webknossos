import { useFetch } from "libs/react_helpers";
import React from "react";
import { AnnotationTypeFilterEnum } from "./project_and_annotation_type_dropdown";
import { getTimeTrackingForUser } from "admin/admin_rest_api";
import dayjs from "dayjs";
import { Table } from "antd";
const { Column } = Table;

type TimeTrackingDetailViewProps = {
    userId: string;
    dateRange: [number, number];
    annotationType: AnnotationTypeFilterEnum;
    projectIds: string[];
};

function TimeTrackingDetailView(props: TimeTrackingDetailViewProps) {
    const userData = useFetch(
        async () => {
            return await getTimeTrackingForUser(
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

    return <Table dataSource={userData} showHeader={false} >
        <Column dataIndex="annotation" key="annotation" />
        <Column dataIndex="time" key="time" />
        <Column dataIndex="timestamp" key="timestamp" render={(timestamp: number) => <>{dayjs(timestamp).format()}</>} />
    </Table>;
}

export default TimeTrackingDetailView;
