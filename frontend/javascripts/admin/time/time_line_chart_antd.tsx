import React from "react";
import { Bar } from "@ant-design/plots";
import { Dayjs } from "dayjs";

export type ColumnDefinition = {
    id?: string;
    type: string;
    role?: string;
    p?: Record<string, any>;
};
export type RowContent = [string, string, string, Date, Date];

export type DateRange = [Dayjs, Dayjs];
type Props = {
    columns: Array<ColumnDefinition>;
    rows: Array<RowContent>;
    timeAxisFormat: string;
    dateRange: DateRange;
};
export function TimeTrackingChart(props: Props) {
    const dataObj = props.rows.map((row) => {
        return {
            tooltipTitle: row[0],
            x: row[1],
            tooltip: row[2],
            start: row[3],
            end: row[4],
        };
    });
    const config = {
        data: dataObj,
        xField: "tooltipTitle",
        yField: ["start", "end"],
        slider: { x: false, y: true }
    };
    return <Bar {...config} />;
}
// TODO: adjust width maybe? too narrow to click properly
// spacing of slider
