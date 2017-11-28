// @flow
import React from "react";
import { Form, Input, Button, Col, Row, Spin } from "antd";
import Request from "libs/request";

const FormItem = Form.Item;

type State = {
  isLoading: boolean,
  currentToken: string,
};

class AuthTokenView extends React.PureComponent<{}, State> {
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

  async revokeToken(): Promise<void> {
    this.setState({ isLoading: true });
    try {
      await Request.triggerRequest("/api/auth/token", { method: "DELETE" });
      const { token } = await Request.receiveJSON("/api/auth/token");
      this.setState({ currentToken: token });
    } finally {
      this.setState({ isLoading: false });
    }
  }

  handleRevokeToken = () => {
    this.revokeToken();
  };

  render() {
    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <Spin size="large" spinning={this.state.isLoading}>
            <h3>Auth Token</h3>
            <Form>
              <FormItem>
                <Input value={this.state.currentToken} readOnly />
              </FormItem>
              <FormItem>
                <Button icon="swap" onClick={this.handleRevokeToken}>
                  Revoke Token
                </Button>
              </FormItem>
            </Form>
          </Spin>
        </Col>
      </Row>
    );
  }
}

export default AuthTokenView;
