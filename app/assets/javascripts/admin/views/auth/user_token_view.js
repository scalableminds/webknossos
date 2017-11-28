// @flow
import React from "react";
import { withRouter } from "react-router-dom";
import { Form, Icon, Input, Button, Col, Row, Alert, Spin } from "antd";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import type { ReactRouterHistoryType } from "react_router";

const FormItem = Form.Item;

type Props = {
  history: ReactRouterHistoryType,
};

type State = {
  isLoading: boolean,
  currentToken: string,
};

class UserTokenView extends React.PureComponent<Props, State> {
  state = {
    isLoading: true,
    currentToken: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const { token } = await Request.receiveJSON("/api/auth/token");

    this.setState({
      isLoading: false,
      currentToken: token,
    });
  }

  render() {
    if (this.state.isLoading) {
      return (
        <div className="text-center">
          <Spin size="large" />
        </div>
      );
    }

    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <Alert
            type="info"
            message={messages["auth.reset_logout"]}
            showIcon
            style={{ marginBottom: 24 }}
          />
          <Form>
            <FormItem><Input value={this.state.currentToken} readOnly />
            </FormItem>
            <FormItem>
              <Button type="primary" style={{ width: "100%" }}>
                Revoke Token
              </Button>
            </FormItem>
          </Form>
        </Col>
      </Row>
    );
  }
}

export default withRouter(Form.create()(UserTokenView));
