// @flow
import React from "react";
import { Form, Input, Button, Col, Row, Spin } from "antd";
import Clipboard from "clipboard-js";
import { getAuthToken, revokeAuthToken } from "admin/admin_rest_api";
import Toast from "libs/toast";

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
    const token = await getAuthToken();

    this.setState({
      isLoading: false,
      currentToken: token,
    });
  }

  handleRevokeToken = async (): Promise<void> => {
    try {
      this.setState({ isLoading: true });
      await revokeAuthToken();
      const token = await getAuthToken();
      this.setState({ currentToken: token });
    } finally {
      this.setState({ isLoading: false });
    }
  };

  copyTokenToClipboard = async () => {
    await Clipboard.copy(this.state.currentToken);
    Toast.success("Token copied to clipboard");
  };

  render() {
    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <Spin size="large" spinning={this.state.isLoading}>
            <h3>Auth Token</h3>
            <Form>
              <FormItem>
                <Input.Group compact>
                  <Input value={this.state.currentToken} style={{ width: "90%" }} readOnly />
                  <Button onClick={this.copyTokenToClipboard} icon="copy" />
                </Input.Group>
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
