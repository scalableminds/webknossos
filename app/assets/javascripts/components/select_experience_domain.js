import * as React from "react";
import { Select } from "antd";
import type { ExperienceDomainListType } from "admin/api_flow_types";
import { getExistingExperienceDomains } from "admin/admin_rest_api";

const Option = Select.Option;

type Props = {
  value: Array<string>,
  disabled: boolean,
  onSelect: () => void,
  onDeselect: () => void,
  alreadyUsedDomains: ExperienceDomainListType,
  selectionLimitedToOneElement: boolean,
};

type State = {
  domains: ExperienceDomainListType,
};

class SelectExperienceDomain extends React.PureComponent<Props, State> {
  static defaultProps = {
    selectionLimitedToOneElement: false,
  };
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
    if (this.props.selectionLimitedToOneElement) {
      return (
        <Select
          mode="tags"
          maxTagCount="1"
          value={this.props.value}
          disabled={this.props.disabled}
          className="experience-input"
          placeholder="New Experience Domains"
          onSelect={this.props.onSelect}
          onDeselect={this.props.onDeselect}
        >
          {this.removeAlreadyUsedDomains().map(domain => <Option key={domain}>{domain}</Option>)}
        </Select>
      );
    } else {
      return (
        <Select
          mode="tags"
          value={this.props.value}
          disabled={this.props.disabled}
          className="experience-input"
          placeholder="New Experience Domains"
          onSelect={this.props.onSelect}
          onDeselect={this.props.onDeselect}
        >
          {this.removeAlreadyUsedDomains().map(domain => <Option key={domain}>{domain}</Option>)}
        </Select>
      );
    }
  }
}

export default SelectExperienceDomain;
