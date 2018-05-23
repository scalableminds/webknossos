import React from "react";
import type {APIOrganizationDataType} from "admin/api_flow_types"
import { getOrganizationData } from "admin/admin_rest_api";

type State = {
  organizationData: API,
};

class Imprint extends React.PureComponent<State> {
  state = {
    organizationData: {},
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const organizationData = await getOrganizationData();

    this.setState({ organizationData });
  }

  render() {
    const imprint = (
  <div className="container" id="impressum">
    <h2>Legal Notice</h2>
    <h3>scalable minds UG (haftungsbeschränkt) & Co. KG</h3>
    <p>Amtsgericht Potsdam, HRA 5753</p>
    <p>Geschäftsführer: scalable minds Verwaltungs UG</p>
    <p>(vertreten durch Tom Bocklisch, Tom Herold, Norman Rzepka)</p>
    <p>USt-Id. DE283513495</p>

    <h5>Visiting address</h5>
    <p>Großbeerenstraße 15</p>
    <p>14482 Potsdam</p>

    <h5>Contact</h5>
    <p>e-mail: hello@scm.io</p>
    <p>
      web: <a href="http://scm.io">scm.io</a>
    </p>

    <h3>Max Planck Institute for Brain Research</h3>
    <p>Dr. Moritz Helmstaedter</p>
    <p>Director</p>

    <h5>Visiting address</h5>
    <p>{this.state.organizationData.address}</p>
    <p>D-60438 Frankfurt am Main</p>

    <h5>Contact</h5>
    <p>phone: {this.state.organizationData.contact}</p>
    <p>e-mail: mhoffice@brain.mpg.de</p>
    <p>
      web: <a href="http://www.brain.mpg.de/connectomics">www.brain.mpg.de/connectomics</a>
    </p>
  </div>
);
    return imprint;
  }

 } 

export default Imprint;
