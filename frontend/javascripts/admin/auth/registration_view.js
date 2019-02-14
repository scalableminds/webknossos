// @flow
import React from "react";
import { Link, withRouter } from "react-router-dom";
import { Row, Col, Card } from "antd";
import type { RouterHistory } from "react-router-dom";
import messages from "messages";
import Toast from "libs/toast";
import RegistrationForm from "./registration_form";

type Props = {
  history: RouterHistory,
  organizationName: ?string,
};

class RegistrationView extends React.PureComponent<Props> {
  getGreetingCard() {
    const { organizationName } = this.props;
    if (organizationName) {
      return (
        <Card style={{ marginBottom: 24 }}>
          You were invited to join the organization &ldquo;{organizationName}&rdquo;!
          <br /> In case you do not know this organization, contact{" "}
          <a href="mailto:hello@scalableminds.com">hello@scalableminds.com</a> to get more
          information about how to get to use webKnossos.
        </Card>
      );
    }

    return (
      <Card style={{ marginBottom: 24 }}>
        Not a member of the listed organizations?
        <br /> Contact <a href="mailto:hello@scalableminds.com">hello@scalableminds.com</a> to get
        more information about how to get to use webKnossos.
      </Card>
    );
  }

  render() {
    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <h3>Registration</h3>
          {this.getGreetingCard()}
          <RegistrationForm
            // The key is used to enforce a remount in case the organizationName changes.
            // That way, we ensure that the organization field is cleared.
            key={this.props.organizationName || "default registration form key"}
            organizationName={this.props.organizationName}
            onRegistered={(isUserLoggedIn?: boolean) => {
              if (isUserLoggedIn) {
                this.props.history.goBack();
              } else {
                Toast.success(messages["auth.account_created"]);
                this.props.history.push("/auth/login");
              }
            }}
            onOrganizationNameNotFound={() => {
              Toast.error(messages["auth.invalid_organization_name"]);
              this.props.history.push("/auth/register");
            }}
          />
          <Link to="/auth/login">Already have an account? Login instead.</Link>
        </Col>
      </Row>
    );
  }
}

export default withRouter(RegistrationView);
