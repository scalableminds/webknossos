import { Button, Col, Result, Row } from "antd";
import { Link } from "react-router-dom";

export function PageNotFoundView() {
  return (
    <Row justify="center" align="middle" className="background-organelles">
      <Col>
        <Result
          icon={<i className="drawing drawing-404" />}
          status="warning"
          title={
            <span style={{ color: "white" }}>Sorry, the page you visited does not exist.</span>
          }
          style={{ height: "100%" }}
          extra={[
            <Link to="/" key="return-to-dashboard">
              <Button>Back to Dashboard</Button>
            </Link>,
          ]}
        />
      </Col>
    </Row>
  );
}
