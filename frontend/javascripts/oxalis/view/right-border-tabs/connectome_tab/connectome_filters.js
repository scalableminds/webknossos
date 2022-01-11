// @flow
import { Checkbox, Divider, Popover } from "antd";
import { FilterOutlined } from "@ant-design/icons";
import React from "react";
import _ from "lodash";

import {
  directionCaptions,
  type Synapse,
  type ConnectomeData,
} from "oxalis/view/right-border-tabs/connectome_tab/synapse_tree";
import ButtonComponent from "oxalis/view/components/button_component";

type ConnectomeFiltersType = {
  synapseTypes: Array<string>,
  synapseDirections: Array<string>,
};

const getFilteredConnectomeData = (
  connectomeData: ?ConnectomeData,
  filters: ConnectomeFiltersType,
  numSynapseTypes: number,
): ?ConnectomeData => {
  if (connectomeData == null) return connectomeData;

  const { synapseTypes, synapseDirections } = filters;

  if (synapseTypes.length === numSynapseTypes && synapseDirections.length === 2) {
    return connectomeData;
  }

  const { agglomerates, synapses, connectomeFile } = connectomeData;

  // Filter by synapse direction by potentially filtering the in/out keys of the agglomerates
  const filteredAgglomerates = _.mapValues(agglomerates, agglomerate =>
    _.pick(agglomerate, synapseDirections),
  );
  // Filter by synapse type by removing all synapses that are not of the selected type(s)
  const filteredSynapses = _.pickBy(synapses, (synapse: Synapse) =>
    synapseTypes.includes(synapse.type),
  );

  return { agglomerates: filteredAgglomerates, synapses: filteredSynapses, connectomeFile };
};

const defaultFilters = {
  synapseTypes: [],
  synapseDirections: ["in", "out"],
};

type Props = {
  connectomeData: ?ConnectomeData,
  availableSynapseTypes: Array<string>,
  onUpdateFilteredConnectomeData: (?ConnectomeData) => void,
  disabled: boolean,
};

type State = {
  filters: ConnectomeFiltersType,
};

class ConnectomeFilters extends React.Component<Props, State> {
  state = {
    filters: defaultFilters,
  };

  componentDidUpdate(prevProps: Props, prevState: State) {
    let { filters } = this.state;
    if (prevProps.availableSynapseTypes !== this.props.availableSynapseTypes) {
      // Avoid using outdated filters in the call to updateFilteredConnectomeData
      filters = this.updateFilters(prevProps.availableSynapseTypes);
    }
    if (
      prevProps.connectomeData !== this.props.connectomeData ||
      prevState.filters !== this.state.filters
    ) {
      this.updateFilteredConnectomeData(filters);
    }
  }

  resetFilters = () => {
    this.setState({
      filters: { ...defaultFilters, synapseTypes: this.props.availableSynapseTypes },
    });
  };

  updateFilters(prevAvailableSynapseTypes: Array<string>) {
    const { availableSynapseTypes } = this.props;
    const { filters } = this.state;
    // Remove filters for synapse types that are no longer valid
    const validOldSynapseTypes = filters.synapseTypes.filter(synapseType =>
      availableSynapseTypes.includes(synapseType),
    );
    // Add positive filters for synapse types that are new
    const newlyAddedSynapseTypes = availableSynapseTypes.filter(
      synapseType => !prevAvailableSynapseTypes.includes(synapseType),
    );
    const newFilters = {
      ...filters,
      synapseTypes: [...validOldSynapseTypes, ...newlyAddedSynapseTypes],
    };
    this.setState({ filters: newFilters });
    return newFilters;
  }

  updateFilteredConnectomeData(filters: ConnectomeFiltersType) {
    const { connectomeData, availableSynapseTypes } = this.props;
    const filteredConnectomeData = getFilteredConnectomeData(
      connectomeData,
      filters,
      availableSynapseTypes.length,
    );
    this.props.onUpdateFilteredConnectomeData(filteredConnectomeData);
  }

  onChangeSynapseDirectionFilter = (synapseDirections: Array<string>) => {
    this.setState(oldState => ({
      filters: {
        ...oldState.filters,
        synapseDirections,
      },
    }));
  };

  onChangeSynapseTypeFilter = (synapseTypes: Array<string>) => {
    this.setState(oldState => ({
      filters: {
        ...oldState.filters,
        synapseTypes,
      },
    }));
  };

  getFilterSettings = () => {
    const { availableSynapseTypes } = this.props;
    const { filters } = this.state;

    const synapseDirectionOptions = Object.keys(directionCaptions).map(direction => ({
      label: directionCaptions[direction],
      value: direction,
    }));
    const synapseTypeOptions = availableSynapseTypes.map(synapseType => ({
      label: synapseType,
      value: synapseType,
    }));

    return (
      <div>
        <h4 style={{ display: "inline-block" }}>Filters</h4>
        <ButtonComponent style={{ float: "right" }} onClick={this.resetFilters}>
          Reset
        </ButtonComponent>
        <Divider style={{ margin: "10px 0" }} />
        <h4>by Synapse Direction</h4>
        <Checkbox.Group
          options={synapseDirectionOptions}
          value={filters.synapseDirections}
          onChange={this.onChangeSynapseDirectionFilter}
        />
        <h4>by Synapse Type</h4>
        <Checkbox.Group
          options={synapseTypeOptions}
          value={filters.synapseTypes}
          onChange={this.onChangeSynapseTypeFilter}
        />
      </div>
    );
  };

  render() {
    const { availableSynapseTypes, disabled } = this.props;
    const { filters } = this.state;
    const isSynapseTypeFilterAvailable = availableSynapseTypes.length;

    const isSynapseTypeFiltered = filters.synapseTypes.length !== availableSynapseTypes.length;
    const isSynapseDirectionFiltered = filters.synapseDirections.length !== 2;
    const isAnyFilterActive = isSynapseTypeFiltered || isSynapseDirectionFiltered;

    return (
      <Popover content={this.getFilterSettings} trigger="click">
        <ButtonComponent disabled={disabled || !isSynapseTypeFilterAvailable}>
          <FilterOutlined style={isAnyFilterActive ? { color: "red" } : {}} />
        </ButtonComponent>
      </Popover>
    );
  }
}

export default ConnectomeFilters;
