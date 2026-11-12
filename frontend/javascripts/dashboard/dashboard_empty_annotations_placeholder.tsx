import { Button, Card, Flex } from "antd";
import { Link } from "react-router";

export function DashboardEmptyAnnotationsPlaceholder() {
  return (
    <Flex justify="center" style={{ padding: "50px 0" }}>
      <Card
        variant="borderless"
        cover={
          <Flex justify="center">
            <i className="drawing drawing-empty-list-annotations" />
          </Flex>
        }
        // Same width as the empty state of the tasks tab.
        style={{ background: "transparent", width: "100%", maxWidth: 400 }}
      >
        <Card.Meta
          title="Create an Annotation"
          style={{ textAlign: "center" }}
          description={
            <>
              <p>Create your first annotation by opening a dataset from the datasets page.</p>
              <Link to="/dashboard/datasets">
                <Button type="primary" style={{ marginTop: 30 }}>
                  Open Datasets Page
                </Button>
              </Link>
            </>
          }
        />
      </Card>
    </Flex>
  );
}
