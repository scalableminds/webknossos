import * as React from "react";
import { Select } from "antd";
import type { ExperienceDomainListType } from "admin/api_flow_types";
import { getExistingExperienceDomains } from "admin/admin_rest_api";

const Option = Select.Option;

type Props = {
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

  removeAlreadyUsedDomains(): ExperienceDomainListType {
    return this.state.domains.filter(domain => !this.props.alreadyUsedDomains.includes(domain));
  }

  render() {
    return (
      <Select
        mode="tags"
        value={[]}
        maxTagCount={1}
        disabled={this.props.disabled}
        className="experience-input"
        placeholder="New Experience Domain"
        onSelect={this.props.onSelect}
        onDeselect={this.props.onDeselect}
      >
        {this.removeAlreadyUsedDomains().map(domain => <Option key={domain}>{domain}</Option>)}
      </Select>
    );
  }
}

export default SelectExperienceDomain;
