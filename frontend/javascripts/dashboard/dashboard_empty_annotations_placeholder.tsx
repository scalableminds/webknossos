import { Button, Card, Col, Flex, Row } from "antd";
import { Link } from "react-router-dom";

export function DashboardEmptyAnnotationsPlaceholder() {
  return (
    <Row gutter={32} justify="center" style={{ padding: 50 }}>
      <Col span="6">
        <Card
          variant="borderless"
          cover={
            <Flex justify="center">
              <i className="drawing drawing-empty-list-annotations" />
            </Flex>
          }
          style={{ background: "transparent" }}
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
      </Col>
    </Row>
  );
}
