// @flow
import { Col, Row } from "antd";
import { type RouterHistory, withRouter } from "react-router-dom";
import React from "react";

import * as Utils from "libs/utils";
import window from "libs/window";
import LoginForm from "./login_form";

type Props = {
  history: RouterHistory,
  redirect?: string,
};

function LoginView({ history, redirect }: Props) {
  const onLoggedIn = () => {
    if (!Utils.hasUrlParam("redirectPage")) {
      if (redirect) {
        // Use "redirect" prop for internal redirects, e.g. for SecuredRoutes
        history.push(redirect);
      } else {
        history.push("/dashboard");
      }
    } else {
      const redirectPage = Utils.getUrlParamValue("redirectPage");
      if (redirectPage.startsWith("/")) {
        history.push(redirectPage);
      } else {
        // Use "redirectPage" URL parameter to cause a full page reload and redirecting to external sites
        // e.g. Discuss
        window.location.replace(redirectPage);
      }
    }
  };

  return (
    <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
      <Col span={8}>
        <h3>Login</h3>
        <LoginForm layout="horizontal" onLoggedIn={onLoggedIn} />
      </Col>
    </Row>
  );
}

export default withRouter(LoginView);
