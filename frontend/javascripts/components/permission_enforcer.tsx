import { Button, Col, Result, Row } from "antd";
import { Link } from "react-router-dom";

export function PageNotAvailableToNormalUser() {
  return (
    <Row justify="center" align="middle" className="full-viewport-height">
      <Col>
        <Result
          status="error"
          title="Forbidden"
          icon={<i className="drawing drawing-forbidden-view" />}
          subTitle={
            <>
              Apologies, but you don't have permission to view this page.
              <br />
              Please reach out to a team manager, dataset manager or administrator to assist you
              with the actions you'd like to take.
            </>
          }
          extra={
            <Link to="/">
              <Button type="primary">Return to Dashboard</Button>
            </Link>
          }
        />
      </Col>
    </Row>
  );
}
