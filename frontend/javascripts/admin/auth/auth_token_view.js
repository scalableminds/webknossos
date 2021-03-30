// @flow
import React from "react";
import { CopyOutlined, SwapOutlined } from "@ant-design/icons";
import { Form } from "@ant-design/compatible";
import { Input, Button, Col, Row, Spin } from "antd";
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
      <div>
        <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
          <Col span={8}>
            <Spin size="large" spinning={this.state.isLoading}>
              <h3>Auth Token</h3>
              <Form>
                <FormItem>
                  <Input.Group compact>
                    <Input value={this.state.currentToken} style={{ width: "90%" }} readOnly />
                    <Button onClick={this.copyTokenToClipboard} icon={<CopyOutlined />} />
                  </Input.Group>
                </FormItem>
                <FormItem>
                  <Button icon={<SwapOutlined />} onClick={this.handleRevokeToken}>
                    Revoke Token
                  </Button>
                </FormItem>
              </Form>
            </Spin>
          </Col>
        </Row>
        <Row type="flex" justify="center" align="middle">
          <Col span={8}>
            An Auth Token is a series of symbols that serves to authenticate you. It is used in
            communication with the backend API and sent with every request to verify your identity.
            <br />
            You should revoke it if somebody else has acquired your token or you have the suspicion
            this has happened.{" "}
            <a href="https://docs.webknossos.org/reference/rest_api#authentication">Read more</a>
          </Col>
        </Row>
      </div>
    );
  }
}

export default AuthTokenView;
