import { Card, Col, Row } from "antd";
import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import * as Utils from "libs/utils";
import window from "libs/window";
import LoginForm from "./login_form";

type Props = {
  history: RouteComponentProps["history"];
  redirect?: string;
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
      // Use "redirectPage" URL parameter to cause a full page reload and redirecting to external sites
      // e.g. Discuss
      window.location.replace(Utils.getUrlParamValue("redirectPage"));
    }
  };

  return (
    <Row justify="center" align="middle" className="login-view">
      <Col xs={22} sm={20} md={16} lg={12} xl={8}>
        <Card className="login-content" style={{ margin: "0 auto" }}>
          <h3>Login</h3>
          <LoginForm layout="horizontal" onLoggedIn={onLoggedIn} />
        </Card>
      </Col>
    </Row>
  );
}

export default withRouter<RouteComponentProps & Props, any>(LoginView);
