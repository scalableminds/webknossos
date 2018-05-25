import React from "react";
import type { APIOrganizationDataType } from "admin/api_flow_types";
import { getOperatorData } from "admin/admin_rest_api";

type Props = {};

type State = {
  operatorData: APIOrganizationDataType,
};

class Imprint extends React.PureComponent<Props, State> {
  state = {
    operatorData: {},
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const operatorData = await getOperatorData();

    this.setState({ operatorData });
  }

  render() {
    return (
      <div className="container" id="impressum">
        <h2>Legal Notice</h2>
        <h3>{this.state.operatorData.name}</h3>
        <div dangerouslySetInnerHTML={{__html: this.state.operatorData.additionalInformation}} />

        <h5>Visiting address</h5>
        <p>{this.state.operatorData.address ? this.state.operatorData.address.street : null}</p>
        <p>{this.state.operatorData.address ? this.state.operatorData.address.town : null}</p>

        <h5>Contact</h5>
        {this.state.operatorData.contact && this.state.operatorData.contact.email ? (
          <p>e-mail: {this.state.operatorData.contact.email}</p>
        ) : null}
        {this.state.operatorData.contact && this.state.operatorData.contact.web ? (
          <p dangerouslySetInnerHTML={{__html: `web: ${this.state.operatorData.contact.web}` }}/>
        ) : null}
        {this.state.operatorData.contact && this.state.operatorData.contact.phone ? (
          <p>phone: {this.state.operatorData.contact.phone}</p>
        ) : null}

        <h3>Max Planck Institute for Brain Research</h3>
        <p>Dr. Moritz Helmstaedter</p>
        <p>Director</p>

        <h5>Visiting address</h5>
        <p>Max-von-Laue-Str. 4</p>
        <p>D-60438 Frankfurt am Main</p>

        <h5>Contact</h5>
        <p>phone: +49 69 850033-3001</p>
        <p>e-mail: mhoffice@brain.mpg.de</p>
        <p>
          web: <a href="http://www.brain.mpg.de/connectomics">www.brain.mpg.de/connectomics</a>
        </p>
      </div>
    );
  }
}

export default Imprint;
