import { Button, Card, Flex } from "antd";
import { Link } from "react-router";

const CARD_MAX_WIDTH = 400;

export function DashboardEmptyTasksPlaceholder({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Flex justify="center">
      <Card
        variant="borderless"
        cover={
          <Flex justify="center">
            <i className="drawing drawing-empty-list-tasks" />
          </Flex>
        }
        style={{ width: "100%", maxWidth: CARD_MAX_WIDTH }}
      >
        <Card.Meta
          title="Request a New Task"
          style={{ textAlign: "center" }}
          description={
            <>
              <p>
                You have no tasks assigned to you. Request a new task by clicking on the{" "}
                <strong>Get a New Task</strong> button above.
              </p>
              {isAdmin && (
                <>
                  <p>
                    Tasks are a powerful way to distribute annotation jobs among groups of users as
                    part of the WEBKNOSSOS project management.
                  </p>
                  <Flex gap="small" justify="center" wrap style={{ marginTop: 24 }}>
                    <Button
                      href="https://docs.webknossos.org/webknossos/tasks_projects/index.html"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Learn more
                    </Button>
                    <Link to="/tasks">
                      <Button type="primary">Create new Tasks</Button>
                    </Link>
                  </Flex>
                </>
              )}
            </>
          }
        />
      </Card>
    </Flex>
  );
}
