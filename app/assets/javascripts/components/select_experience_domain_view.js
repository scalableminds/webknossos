import * as React from "react";
import { Select } from "antd";
import type { ExperienceDomainListType } from "admin/api_flow_types";
import { getExistingExperienceDomains } from "admin/admin_rest_api";

const Option = Select.Option;

type Props = {
  disabled: boolean,
  onSelect: () => void,
  onDeselect: () => void,
};

type State = {
  domains: ExperienceDomainListType,
};

class SelectExperienceDomainView extends React.PureComponent<Props, State> {
  state = {
    domains: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const domains = await getExistingExperienceDomains();
    this.setState({ domains });
  }

  render() {
    return (
      <Select
        mode="tags"
        disabled={this.props.disabled}
        className="experience-input"
        placeholder="New Experience Domains"
        onSelect={this.props.onSelect}
        onDeselect={this.props.onDeselect}
      >
        {this.state.domains.map(domain => <Option key={domain}>{domain}</Option>)}
      </Select>
    );
  }
}

export default SelectExperienceDomainView;
