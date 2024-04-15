import React from "react";
import { Button, Result, Col, Row } from "antd";
import { Link } from "react-router-dom";

export function PageNotAvailableToNormalUser() {
  return (
    <Row justify="center" align="middle" className="full-viewport-height">
      <Col>
        <Result
          status="403"
          title="403"
          subTitle={
            <>
              Apologies, but you don't have permission to view this page.
              <br />
              Please reach out to a team manager or administrator to assist you with the actions
              you'd like to take.
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
