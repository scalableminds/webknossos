import { CalendarOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getCreditTransactions } from "admin/api/organization";
import { getJobTypeName } from "admin/job/job_list_view";
import { Button, DatePicker, Space, Spin, Table, Tag, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import FormattedId from "components/formatted_id";
import dayjs from "dayjs";
import { formatMilliCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import type { APICreditState, APICreditTransaction, APIJob } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";

const { Column } = Table;

const SYSTEM_USER_LABEL = "System";
const NO_JOB_FILTER_VALUE = "__NO_JOB__";
const NO_JOB_LABEL = "No job";
const dateFilterFormat = "YYYY-MM-DD";
const dateRangeSeparator = "|";
const datePresets = [
  { label: "Last 7 days", value: [dayjs().subtract(6, "day"), dayjs()] },
  { label: "Last 30 days", value: [dayjs().subtract(29, "day"), dayjs()] },
  { label: "Last 90 days", value: [dayjs().subtract(89, "day"), dayjs()] },
  {
    label: "Last month",
    value: [
      dayjs().subtract(1, "month").startOf("month"),
      dayjs().subtract(1, "month").endOf("month"),
    ],
  },
  {
    label: "This month",
    value: [dayjs().startOf("month"), dayjs().endOf("month")],
  },
  {
    label: "Year to date",
    value: [dayjs().startOf("year"), dayjs()],
  },
] as const;

const creditStateColors: Partial<Record<APICreditState, string>> = {
  AddCredits: "green",
  Spent: "red",
  Refunded: "gold",
  Revoked: "volcano",
  PartiallyRevoked: "orange",
  Refunding: "blue",
  Revoking: "purple",
};

function formatCreditDelta(credits: number): string {
  const sign = credits > 0 ? "+" : credits < 0 ? "-" : "";
  return `${sign}${formatMilliCreditsString(Math.abs(credits))}`;
}

function getUserInfo(job: APIJob | null | undefined) {
  if (job == null) {
    return {
      label: SYSTEM_USER_LABEL,
      value: SYSTEM_USER_LABEL,
      text: SYSTEM_USER_LABEL,
    };
  }
  const label = `${job.ownerLastName}, ${job.ownerFirstName}`;
  return {
    label,
    value: job.ownerEmail,
    text: `${label} (${job.ownerEmail})`,
  };
}

function getJobLabel(job: APIJob | null | undefined): string {
  return job ? getJobTypeName(job.command) : "";
}

function parseRangeValue(value: string | undefined) {
  const [start, end] = (value ?? "").split(dateRangeSeparator);
  return [
    start ? dayjs(start, dateFilterFormat) : null,
    end ? dayjs(end, dateFilterFormat) : null,
  ] as const;
}

function toRangeValue(dates: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) {
  if (dates?.[0] && dates?.[1]) {
    return [
      `${dates[0].format(dateFilterFormat)}${dateRangeSeparator}${dates[1].format(dateFilterFormat)}`,
    ];
  }
  return [];
}

function renderJob(job: APIJob | null | undefined) {
  if (job == null) {
    return null;
  }
  const datasetLabel = job.args.datasetName || job.args.datasetDirectoryName;
  return (
    <div>
      <div>{getJobTypeName(job.command)}</div>
      {datasetLabel ? <div>{datasetLabel}</div> : null}
      <FormattedId id={job.id} />
    </div>
  );
}

export function OrganizationCreditActivityView() {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["credit-transactions"],
    queryFn: getCreditTransactions,
  });

  const organizationTransactions = useMemo(() => {
    return transactions
      .filter((transaction) => transaction.organization_id === organization.id)
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [transactions, organization.id]);

  const jobFilters = useMemo(() => {
    const options = new Map<string, string>();
    organizationTransactions.forEach(({ paidJob }) => {
      options.set(
        paidJob ? paidJob.command : NO_JOB_FILTER_VALUE,
        paidJob ? getJobTypeName(paidJob.command) : NO_JOB_LABEL,
      );
    });
    return Array.from(options.entries()).map(([value, text]) => ({ value, text }));
  }, [organizationTransactions]);

  const userFilters = useMemo(() => {
    const options = new Map<string, string>();
    organizationTransactions.forEach(({ paidJob }) => {
      const { value, text } = getUserInfo(paidJob);
      options.set(value, text);
    });
    return Array.from(options.entries()).map(([value, text]) => ({ value, text }));
  }, [organizationTransactions]);

  const stateFilters = useMemo(() => {
    return Array.from(new Set(organizationTransactions.map(({ creditState }) => creditState)))
      .sort()
      .map((state) => ({ text: state, value: state }));
  }, [organizationTransactions]);

  return (
    <>
      <SettingsTitle
        title="Credit Activity"
        description="Review credit purchases, spending, and refunds for your organization."
      />
      <Spin spinning={isLoading}>
        <Table
          dataSource={organizationTransactions}
          rowKey="id"
          pagination={{ defaultPageSize: 50 }}
          locale={{ emptyText: "No credit activity recorded yet." }}
          style={{ marginTop: 16 }}
          summary={(pageData) => {
            const totalCredits = pageData.reduce(
              (sum, transaction) => sum + transaction.creditChange,
              0,
            );
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
                <Table.Summary.Cell index={1}>
                  <Typography.Text>{formatCreditDelta(totalCredits)} credits</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} colSpan={4} />
              </Table.Summary.Row>
            );
          }}
        >
          <Column
            title="Date"
            key="createdAt"
            width={170}
            render={(transaction: APICreditTransaction) => {
              const utcTimestamp = dayjs.utc(transaction.createdAt);
              const localTimestamp = utcTimestamp.local();
              return (
                <FastTooltip
                  title={`The displayed time refers to your local timezone. In UTC, the time is: ${utcTimestamp.format(
                    "YYYY-MM-DD HH:mm",
                  )}`}
                >
                  <div>
                    <div>{localTimestamp.format("YYYY-MM-DD")}</div>
                    <Typography.Text type="secondary">
                      {localTimestamp.format("HH:mm")}
                    </Typography.Text>
                  </div>
                </FastTooltip>
              );
            }}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              left.createdAt - right.createdAt
            }
            defaultSortOrder="descend"
            filterDropdown={({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
              const [startDate, endDate] = parseRangeValue(selectedKeys[0] as string | undefined);
              return (
                <Space style={{ padding: 8 }}>
                  <DatePicker.RangePicker
                    value={startDate && endDate ? [startDate, endDate] : null}
                    onChange={(dates) => setSelectedKeys(toRangeValue(dates))}
                    allowClear
                    presets={datePresets}
                  />
                  <Button type="primary" size="small" onClick={() => confirm()}>
                    Apply
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      clearFilters?.();
                      confirm();
                    }}
                  >
                    Reset
                  </Button>
                </Space>
              );
            }}
            filterIcon={(filtered) => (
              <CalendarOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
            )}
            onFilter={(value, record) => {
              const [startDate, endDate] = parseRangeValue(value as string);
              if (startDate == null || endDate == null) {
                return true;
              }
              const recordDate = dayjs(record.createdAt);
              return !recordDate.isBefore(startDate, "day") && !recordDate.isAfter(endDate, "day");
            }}
          />
          <Column
            title="Credit Change"
            key="creditChange"
            width={130}
            render={(transaction: APICreditTransaction) => {
              const formattedChange = formatCreditDelta(transaction.creditChange);
              const textType =
                transaction.creditChange < 0
                  ? "danger"
                  : transaction.creditChange > 0
                    ? "success"
                    : undefined;
              return <Typography.Text type={textType}>{formattedChange} credits</Typography.Text>;
            }}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              left.creditChange - right.creditChange
            }
          />
          <Column
            title="Details"
            dataIndex="comment"
            key="comment"
            width={320}
            render={(comment: string) => (
              <Typography.Text style={{ whiteSpace: "normal" }}>{comment}</Typography.Text>
            )}
          />
          <Column
            title="Job"
            key="paidJob"
            width={200}
            render={(transaction: APICreditTransaction) => renderJob(transaction.paidJob)}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              getJobLabel(left.paidJob).localeCompare(getJobLabel(right.paidJob))
            }
            filters={jobFilters}
            onFilter={(value, record: APICreditTransaction) =>
              value === NO_JOB_FILTER_VALUE
                ? record.paidJob == null
                : record.paidJob?.command === value
            }
          />
          <Column
            title="User"
            key="user"
            width={200}
            render={(transaction: APICreditTransaction) => {
              const job = transaction.paidJob;
              const userInfo = getUserInfo(job);
              if (job == null) {
                return userInfo.label;
              }
              return (
                <div>
                  <div>{userInfo.label}</div>
                  <Typography.Text type="secondary">({job.ownerEmail})</Typography.Text>
                </div>
              );
            }}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              getUserInfo(left.paidJob).label.localeCompare(getUserInfo(right.paidJob).label)
            }
            filters={userFilters}
            onFilter={(value, record: APICreditTransaction) =>
              getUserInfo(record.paidJob).value === value
            }
          />
          <Column
            title="State"
            key="state"
            width={160}
            render={(transaction: APICreditTransaction) => (
              <Tag color={creditStateColors[transaction.creditState]}>
                {transaction.creditState}
              </Tag>
            )}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              left.creditState.localeCompare(right.creditState)
            }
            filters={stateFilters}
            onFilter={(value, record: APICreditTransaction) => record.creditState === value}
          />
        </Table>
      </Spin>
    </>
  );
}
