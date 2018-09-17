import * as React from "react";
import { Select } from "antd";
import type { ExperienceDomainListType } from "admin/api_flow_types";
import { getExistingExperienceDomains } from "admin/admin_rest_api";

const Option = Select.Option;

type Props = {
  value: string,
  disabled: boolean,
  onSelect: () => void,
  onDeselect: () => void,
  alreadyUsedDomains: ExperienceDomainListType,
};

type State = {
  domains: ExperienceDomainListType,
};

class SelectExperienceDomain extends React.PureComponent<Props, State> {
  state = {
    domains: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    this.setState({ domains: await getExistingExperienceDomains() });
  }

  getUnusedDomains(): ExperienceDomainListType {
    return this.state.domains.filter(domain => !this.props.alreadyUsedDomains.includes(domain));
  }

  render() {
    return (
      <Select
        mode="tags"
        value={this.props.value}
        maxTagCount={1}
        style={{ width: `${this.props.width}%` }}
        disabled={this.props.disabled}
        placeholder="New Experience Domain"
        onSelect={this.props.onSelect}
        onDeselect={this.props.onDeselect}
      >
        {this.getUnusedDomains().map(domain => <Option key={domain}>{domain}</Option>)}
      </Select>
    );
  }
}

export default SelectExperienceDomain;
