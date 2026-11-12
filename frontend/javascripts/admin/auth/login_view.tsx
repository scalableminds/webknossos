import { Card, Col, Row, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { getUrlParamValue, hasUrlParam } from "libs/utils";
import window from "libs/window";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import LoginForm from "./login_form";

type Props = {
  redirect?: string;
};

function LoginView({ redirect }: Props) {
  const navigate = useNavigate();
  const isAuthenticated = useWkSelector((state) => state.activeUser != null);

  // Redirect once the user is logged in, either because they just logged in through
  // the form or because they were already logged in when opening this page.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (hasUrlParam("redirectPage")) {
      // Use "redirectPage" URL parameter to cause a full page reload and redirecting to external sites
      // e.g. Discuss
      window.location.replace(getUrlParamValue("redirectPage"));
    } else {
      // Use "redirect" prop for internal redirects, e.g. for SecuredRoutes
      navigate(redirect ?? "/dashboard");
    }
  }, [isAuthenticated, redirect, navigate]);

  return (
    <Row justify="center" align="middle" className="login-view">
      <Col xs={22} sm={20} md={16} lg={12} xl={8}>
        <Card className="login-content" style={{ margin: "0 auto" }}>
          <Typography.Title level={3}>Login</Typography.Title>
          <LoginForm layout="horizontal" />
        </Card>
      </Col>
    </Row>
  );
}

export default LoginView;
