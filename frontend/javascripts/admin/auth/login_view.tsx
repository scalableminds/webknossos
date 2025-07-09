import { Card, Col, Row } from "antd";
import * as Utils from "libs/utils";
import window from "libs/window";
import { useNavigate } from "react-router-dom";
import LoginForm from "./login_form";
import { useWkSelector } from "libs/react_hooks";

type Props = {
  redirect?: string;
};

function LoginView({ redirect }: Props) {
  const navigate = useNavigate();
  const isAuthenticated = useWkSelector((state) => state.activeUser != null);

  if (isAuthenticated) {
    // If you're already logged in, redirect to the dashboard
    navigate("/");
  }

  const onLoggedIn = () => {
    if (!Utils.hasUrlParam("redirectPage")) {
      if (redirect) {
        // Use "redirect" prop for internal redirects, e.g. for SecuredRoutes
        navigate(redirect);
      } else {
        navigate("/dashboard");
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

export default LoginView;
