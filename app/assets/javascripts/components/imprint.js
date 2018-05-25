import React from "react";
import { getOperatorData, getOrganizationData } from "admin/admin_rest_api";

type Props = {};

type State = {
  operatorData: string,
  organizationData: string,
};

class Imprint extends React.PureComponent<Props, State> {
  state = {
    operatorData: "",
    organizationData: "",
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
      <div className="container" id="impressum">
        <h2>Legal Notice</h2>
        <div dangerouslySetInnerHTML={{ __html: this.state.operatorData }} />
        <div dangerouslySetInnerHTML={{ __html: this.state.organizationData }} />
      </div>
    );
  }
}

export default Imprint;
