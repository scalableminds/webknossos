import { Row, Col, Form, Button } from "antd";
import type { APITeam } from "types/api_flow_types";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
const FormItem = Form.Item;
type Props = {
  value?: APITeam | null | undefined;
  onChange: (team: APITeam) => Promise<any> | void;
};

function TeamSelectionForm({ value, onChange }: Props) {
  const [form] = Form.useForm();

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  const handleFormSubmit = (formValues) => {
    onChange(formValues.team);
  };

  const formItemLayout = {
    labelCol: {
      span: 5,
    },
    wrapperCol: {
      span: 19,
    },
  };
  return (
    <Form
      onFinish={handleFormSubmit}
      form={form}
      initialValues={[
        {
          team: value,
        },
      ]}
    >
      <Row gutter={40}>
        <Col span={12}>
          <FormItem
            name="team"
            {...formItemLayout}
            label="Team"
            style={{
              marginBottom: 0,
            }}
          >
            <TeamSelectionComponent />
          </FormItem>
        </Col>
        <Col span={12}>
          <Button type="primary" htmlType="submit">
            Search
          </Button>
        </Col>
      </Row>
    </Form>
  );
}

export default TeamSelectionForm;
