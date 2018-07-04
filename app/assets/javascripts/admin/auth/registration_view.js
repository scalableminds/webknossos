// @flow
import React from "react";
import { Link, withRouter } from "react-router-dom";
import { Row, Col, Card } from "antd";
import type { RouterHistory } from "react-router-dom";
import RegistrationForm from "./registration_form";

type Props = {
  history: RouterHistory,
};

class RegistrationView extends React.PureComponent<Props> {
  render() {
    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <h3>Registration</h3>
          <Card style={{ marginBottom: 24 }}>
            Not a member of the listed organizations?<br /> Contact{" "}
            <a href="mailto:hello@scalableminds.com">hello@scalableminds.com</a> to get more
            information about how to get to use webKnossos.
          </Card>
          <RegistrationForm onRegistered={() => this.props.history.push("/auth/login")} />
          <Link to="/auth/login">Already have an account? Login instead.</Link>
        </Col>
      </Row>
    );
  }
}

export default withRouter(RegistrationView);
