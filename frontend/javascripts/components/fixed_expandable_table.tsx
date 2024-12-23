import { Button, Table, type TableProps } from "antd";
import type { ColumnsType, GetRowKey } from "antd/lib/table/interface";
import React from "react";

type State = {
  expandedRows: Array<string>;
  className?: string;
};
/** This is a wrapper for large tables that have fixed columns and support expanded rows.
 *  This wrapper ensures that when rows are expanded no column is fixed as this creates rendering bugs.
 *  If you are using this wrapper, you do not need to set the class "large-table"
 *  and the scroll prop as this is already done by the wrapper.
 */

// Enforce the "columns" prop which is optional by default otherwise
type OwnTableProps<RecordType = any> = TableProps<RecordType> & {
  columns: ColumnsType<RecordType>;
};

const EMPTY_ARRAY: string[] = [] as const;

export default class FixedExpandableTable extends React.PureComponent<OwnTableProps, State> {
  state: State = {
    expandedRows: EMPTY_ARRAY,
  };

  getAllRowIds(
    dataSource: readonly any[] | undefined,
    rowKey: string | number | symbol | GetRowKey<any> | undefined,
  ) {
    const canUseRowKey = typeof rowKey === "string";
    return dataSource != null && canUseRowKey ? dataSource.map((row) => row[rowKey]) : [];
  }

  componentDidUpdate(prevProps: Readonly<TableProps<any>>): void {
    if (prevProps.dataSource !== this.props.dataSource) {
      this.setState({ expandedRows: EMPTY_ARRAY });
    }
  }

  render() {
    const { expandedRows } = this.state;
    const { className, expandable, ...restProps } = this.props;
    const { dataSource, rowKey } = this.props;
    const areAllRowsExpanded =
      dataSource != null && this.state.expandedRows.length === dataSource?.length;

    const columnTitleCollapsed = (
      <Button
        className="ant-table-row-expand-icon ant-table-row-expand-icon-collapsed"
        title="Expand all rows"
        onClick={() => this.setState({ expandedRows: this.getAllRowIds(dataSource, rowKey) })}
      />
    );
    const columnTitleExpanded = (
      <Button
        className="ant-table-row-expand-icon ant-table-row-expand-icon-expanded"
        title="Collapse all rows"
        onClick={() => this.setState({ expandedRows: EMPTY_ARRAY })}
      />
    );
    const columnsWithAdjustedFixedProp: TableProps["columns"] = this.props.columns.map((column) => {
      const columnFixed = expandedRows.length > 0 ? false : column.fixed;
      return { ...column, fixed: columnFixed };
    });
    const expandableProp = {
      ...expandable,
      expandedRowKeys: expandedRows,
      onExpandedRowsChange: (selectedRows: readonly React.Key[]) => {
        this.setState({
          expandedRows: selectedRows as string[],
        });
      },
      columnTitle: areAllRowsExpanded ? columnTitleExpanded : columnTitleCollapsed,
    };
    return (
      <Table
        {...restProps}
        expandable={expandableProp}
        scroll={{
          x: "max-content",
        }}
        className={`large-table ${className}`}
        columns={columnsWithAdjustedFixedProp}
      />
    );
  }
}
