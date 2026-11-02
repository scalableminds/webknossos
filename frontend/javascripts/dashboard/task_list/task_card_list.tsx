import {
  Card,
  Col,
  Descriptions,
  type DescriptionsProps,
  Flex,
  Grid,
  List,
  Row,
  type SpaceProps,
  Tag,
} from "antd";
import classNames from "classnames";
import FormattedDate from "components/formatted_date";
import FormattedId from "components/formatted_id";
import Markdown from "libs/markdown_adapter";
import { scrollToTop } from "libs/utils";
import type { ReactNode } from "react";
import type { APITaskWithAnnotation } from "types/api_types";
import {
  getSkeletonDescriptor,
  getVolumeDescriptors,
} from "viewer/model/accessors/annotation_accessor";

// List items are bare cards without a <List.Item>, so the list adds no spacing between them.
const TASK_CARD_STYLE = { marginBottom: 16 };

function TaskCardTitle({ task }: { task: APITaskWithAnnotation }) {
  return (
    <Flex vertical gap={4} style={{ paddingBlock: 12 }}>
      <span style={{ overflowWrap: "anywhere" }}>
        {task.projectName} (<FormattedDate timestamp={task.created} />)
      </span>
      <Flex wrap gap={4}>
        {getSkeletonDescriptor(task.annotation) == null ? null : (
          <Tag color="success" variant="outlined">
            skeleton
          </Tag>
        )}
        {getVolumeDescriptors(task.annotation).length === 0 ? null : (
          <Tag color="warning" variant="outlined">
            volume
          </Tag>
        )}
        {task.type.settings.allowedModes.map((mode) => (
          <Tag key={mode} variant="outlined">
            {mode}
          </Tag>
        ))}
      </Flex>
    </Flex>
  );
}

export function TaskCardList({
  tasks,
  showFinishedTasks,
  isAdminView,
  isLoading,
  placeholder,
  renderActions,
}: {
  tasks: APITaskWithAnnotation[];
  showFinishedTasks: boolean;
  isAdminView: boolean;
  isLoading: boolean;
  placeholder: ReactNode;
  renderActions: (task: APITaskWithAnnotation, orientation: SpaceProps["orientation"]) => ReactNode;
}) {
  // Read once for the whole list instead of subscribing to breakpoint changes in every card.
  const isMultiColumn = Grid.useBreakpoint().md ?? false;
  const descriptionClassName = classNames("task-type-description", { short: isAdminView });

  const renderTaskCard = (task: APITaskWithAnnotation) =>
    showFinishedTasks ? (
      <Card key={task.id} style={TASK_CARD_STYLE}>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 3 }}
          styles={{ content: { overflowWrap: "anywhere" } }}
          items={[
            { key: "id", label: "Task ID", children: <FormattedId id={task.id} /> },
            { key: "project", label: "Project", children: task.projectName },
            {
              key: "finished",
              label: "Finished",
              children: <FormattedDate timestamp={task.annotation.modified} />,
            },
          ]}
        />
      </Card>
    ) : (
      <Card
        key={task.id}
        style={TASK_CARD_STYLE}
        title={<TaskCardTitle task={task} />}
        styles={{ title: { whiteSpace: "normal" } }}
      >
        <OpenTaskCardBody
          isMultiColumn={isMultiColumn}
          description={
            <div className={descriptionClassName}>
              <Markdown>{task.type.description}</Markdown>
            </div>
          }
          details={[
            { key: "id", label: "Task ID", children: <FormattedId id={task.id} /> },
            { key: "type", label: "Task Type", children: task.type.summary },
          ]}
          renderActions={(orientation) => renderActions(task, orientation)}
        />
      </Card>
    );

  return (
    <List
      dataSource={tasks}
      pagination={
        tasks.length > 0
          ? {
              defaultPageSize: 50,
              onChange: scrollToTop,
            }
          : false
      }
      loading={isLoading}
      renderItem={renderTaskCard}
      locale={{ emptyText: placeholder }}
    />
  );
}

// Three columns (description, details, actions) from `md` on. The details column is narrow
// there, so labels go above their values. Below `md`, the columns stack, labels sit next to
// their values and the actions become a wrapping row instead of a tall vertical list.
function OpenTaskCardBody({
  isMultiColumn,
  description,
  details,
  renderActions,
}: {
  isMultiColumn: boolean;
  description: ReactNode;
  details: DescriptionsProps["items"];
  renderActions: (orientation: SpaceProps["orientation"]) => ReactNode;
}) {
  return (
    <Row gutter={[24, 16]}>
      <Col xs={24} md={12} xl={14}>
        {description}
      </Col>
      <Col xs={24} md={6} xl={5}>
        <Descriptions
          size="small"
          column={1}
          layout={isMultiColumn ? "vertical" : "horizontal"}
          styles={{ content: { overflowWrap: "anywhere" } }}
          items={details}
        />
      </Col>
      <Col xs={24} md={6} xl={5}>
        {renderActions(isMultiColumn ? "vertical" : "horizontal")}
      </Col>
    </Row>
  );
}
