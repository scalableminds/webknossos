// @flow

import React from "react";
import { Link, withRouter } from "react-router-dom";
import { Form, Input, Button, Row, Col, Icon, Card, Select } from "antd";
import messages from "messages";
import Request from "libs/request";
import type { APITeamType } from "admin/api_flow_types";
import Toast from "libs/toast";
import type { ReactRouterHistoryType } from "react-router";

const FormItem = Form.Item;
const Option = Select.Option;

type Props = {
  form: Object,
  history: ReactRouterHistoryType,
};

type State = {
  confirmDirty: boolean,
  teams: Array<APITeamType>,
};

class RegistrationView extends React.PureComponent<Props, State> {
  state = {
    confirmDirty: false,
    teams: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const url = "/api/allTeams";
    const teams = await Request.receiveJSON(url);

    this.setState({ teams });
  }

  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFieldsAndScroll((err: ?Object, formValues: Object) => {
      if (!err) {
        Request.sendJSONReceiveJSON("/api/register", { data: formValues }).then(() => {
          // if(...)
          Toast.success(messages["auth.account_created"]);
          // else
          // Toast.success(messages["auth.automatic_user_activation"])
          this.props.history.push("/login");
        });
      }
    });
  };

  handleConfirmBlur = (e: SyntheticInputEvent<>) => {
    const value = e.target.value;
    this.setState({ confirmDirty: this.state.confirmDirty || !!value });
  };

  checkPassword = (rule, value, callback) => {
    const form = this.props.form;
    if (value && value !== form.getFieldValue("password1")) {
      callback(messages["auth.registration_password_missmatch"]);
    } else {
      callback();
    }
  };

  checkConfirm = (rule, value, callback) => {
    const form = this.props.form;
    if (value && this.state.confirmDirty) {
      form.validateFields(["confirm"], { force: true });
    }
    callback();
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    // const teamComponents =
    //   this.state.teams.length > 0 ? (
    //     <FormItem hasFeedback>
    //       {getFieldDecorator("team", {
    //         rules: [
    //           {
    //             required: true,
    //             message: messages["auth.registration_team_input"],
    //           },
    //         ],
    //       })(
    //         <Select placeholder="Team">
    //           {this.state.teams.map(team => (
    //             <Option value={team.name} key={team.name}>
    //               {team.name}
    //             </Option>
    //           ))}
    //         </Select>,
    //       )}
    //     </FormItem>
    //   ) : (
    //     <FormItem hasFeedback>{getFieldDecorator("team")(<input type="hidden" />)}</FormItem>
    //   );

    const teamComponents = (
      <FormItem hasFeedback>
        {getFieldDecorator("team", {
          rules: [
            {
              required: true,
              message: messages["auth.registration_team_input"],
            },
          ],
        })(
          <Select placeholder="Team">
            {this.state.teams.map(team => (
              <Option value={team.name} key={team.name}>
                {team.name}
              </Option>
            ))}
          </Select>,
        )}
      </FormItem>
    );

    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <Card style={{ marginBottom: 24 }}>
            Not a member of the listed teams?<br /> Contact webknossos@scalableminds.com to get more
            information about how to get to use webKnossos.
          </Card>
          <Form onSubmit={this.handleSubmit}>
            {teamComponents}
            <FormItem hasFeedback>
              {getFieldDecorator("email", {
                rules: [
                  {
                    type: "email",
                    message: messages["auth.registration_email_invalid"],
                  },
                  {
                    required: true,
                    message: messages["auth.registration_email_input"],
                  },
                ],
              })(
                <Input
                  prefix={<Icon type="mail" style={{ fontSize: 13 }} />}
                  placeholder="Email"
                />,
              )}
            </FormItem>
            <FormItem hasFeedback>
              {getFieldDecorator("firstName", {
                rules: [
                  {
                    required: true,
                    message: messages["auth.registration_firstName_input"],
                  },
                ],
              })(
                <Input
                  prefix={<Icon type="user" style={{ fontSize: 13 }} />}
                  placeholder="First Name"
                />,
              )}
            </FormItem>
            <FormItem hasFeedback>
              {getFieldDecorator("lastName", {
                rules: [
                  {
                    required: true,
                    message: messages["auth.registration_lastName_input"],
                  },
                ],
              })(
                <Input
                  prefix={<Icon type="user" style={{ fontSize: 13 }} />}
                  placeholder="Last Name"
                />,
              )}
            </FormItem>
            <FormItem hasFeedback>
              {getFieldDecorator("password1", {
                rules: [
                  {
                    required: true,
                    message: messages["auth.registration_password_input"],
                  },
                  {
                    min: 8,
                    message: messages["auth.registration_password_length"],
                  },
                  {
                    validator: this.checkConfirm,
                  },
                ],
              })(
                <Input
                  type="password"
                  prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
                  placeholder="Password"
                />,
              )}
            </FormItem>
            <FormItem hasFeedback>
              {getFieldDecorator("password2", {
                rules: [
                  {
                    required: true,
                    message: messages["auth.registration_password_confirm"],
                  },
                  {
                    min: 8,
                    message: messages["auth.registration_password_length"],
                  },
                  {
                    validator: this.checkPassword,
                  },
                ],
              })(
                <Input
                  type="password"
                  onBlur={this.handleConfirmBlur}
                  prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
                  placeholder="Confirm Password"
                />,
              )}
            </FormItem>
            <FormItem>
              <Button type="primary" htmlType="submit" style={{ width: "100%" }}>
                Register
              </Button>
              <Link to="/login">Already have an account? Login instead.</Link>
            </FormItem>
          </Form>
        </Col>
      </Row>
    );
  }
}

export default withRouter(Form.create()(RegistrationView));
