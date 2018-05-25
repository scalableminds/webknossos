import React from "react";
import { Row, Col } from "antd";
import { getOperatorData, getOrganizationData } from "admin/admin_rest_api";

type Props = {};

type State = {
  operatorData: string,
  organizationData: string,
};

class Imprint extends React.PureComponent<Props, State> {
  state = {
    operatorData: "",
    organizationData: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const operatorData = await getOperatorData();
    const organizationData = await getOrganizationData();

    this.setState({ operatorData, organizationData });
  }

  render() {
    return (
      <div className="container text">
        <Row>
          <Col offset={6} span={12}>
            <h2>Imprint</h2>
            <div dangerouslySetInnerHTML={{ __html: this.state.operatorData }} />
            {this.state.organizationData.map(data => (
              <div key={data} dangerouslySetInnerHTML={{ __html: data }} />
            ))}
          </Col>
        </Row>
      </div>
    );
  }
}

export default Imprint;
