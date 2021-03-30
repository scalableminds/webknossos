// @flow

import { Select } from "antd";
import * as React from "react";

import type { ExperienceDomainList } from "types/api_flow_types";
import { getExistingExperienceDomains } from "admin/admin_rest_api";

type Props = {
  value?: string | Array<string>,
  width: number,
  placeholder: string,
  notFoundContent?: string,
  disabled: boolean,
  onSelect?: string => void,
  onChange?: () => void,
  allowCreation: boolean,
  alreadyUsedDomains: ExperienceDomainList,
};

type State = {
  domains: ExperienceDomainList,
  currentlyEnteredDomain: string,
};

class SelectExperienceDomain extends React.PureComponent<Props, State> {
  static defaultProps = {
    alreadyUsedDomains: [],
    allowCreation: false,
  };

  state = {
    domains: [],
    currentlyEnteredDomain: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    this.setState({ domains: await getExistingExperienceDomains() });
  }

  getUnusedDomains(): ExperienceDomainList {
    return this.state.domains.filter(domain => !this.props.alreadyUsedDomains.includes(domain));
  }

  onSearch = (domain: string) => {
    this.setState({ currentlyEnteredDomain: domain });
  };

  render() {
    const {
      value,
      notFoundContent,
      width,
      disabled,
      placeholder,
      onSelect,
      onChange,
      allowCreation,
    } = this.props;
    const { currentlyEnteredDomain } = this.state;
    let options = this.getUnusedDomains();
    if (
      allowCreation &&
      !options.includes(currentlyEnteredDomain) &&
      currentlyEnteredDomain.trim() !== ""
    ) {
      options = [...options, currentlyEnteredDomain];
    }

    return (
      <Select
        showSearch
        value={value}
        optionFilterProp="children"
        notFoundContent={notFoundContent}
        style={{ width: `${width}%` }}
        disabled={disabled}
        placeholder={placeholder}
        onSelect={onSelect}
        onChange={onChange}
        onSearch={this.onSearch}
        options={options.map(domain => ({ value: domain, label: domain }))}
      />
    );
  }
}

export default SelectExperienceDomain;
