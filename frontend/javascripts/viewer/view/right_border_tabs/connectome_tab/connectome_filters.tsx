import { FilterOutlined } from "@ant-design/icons";
import { Button, Checkbox, Divider, Flex, Popover, Tooltip, Typography } from "antd";
import mapValues from "lodash-es/mapValues";
import pick from "lodash-es/pick";
import pickBy from "lodash-es/pickBy";
import { useEffect, useState } from "react";
import ButtonComponent from "viewer/view/components/button_component";
import type {
  ConnectomeData,
  DirectionCaptionsKeys,
  Synapse,
} from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";
import { directionCaptions } from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";

type SynapseDirection = "in" | "out";

type ConnectomeFiltersType = {
  synapseTypes: string[];
  synapseDirections: SynapseDirection[];
};

const getFilteredConnectomeData = (
  connectomeData: ConnectomeData | null | undefined,
  filters: ConnectomeFiltersType,
  numSynapseTypes: number,
): ConnectomeData | null | undefined => {
  if (connectomeData == null) return connectomeData;
  const { synapseTypes, synapseDirections } = filters;

  if (synapseTypes.length === numSynapseTypes && synapseDirections.length === 2) {
    return connectomeData;
  }

  const { agglomerates, synapses, connectomeFile } = connectomeData;

  // Filter by synapse direction by potentially filtering the in/out keys of the agglomerates
  const filteredAgglomerates = mapValues(agglomerates, (agglomerate) =>
    pick(agglomerate, synapseDirections),
  );

  // Filter by synapse type by removing all synapses that are not of the selected type(s)
  const filteredSynapses = pickBy(synapses, (synapse: Synapse) =>
    synapseTypes.includes(synapse.type),
  );

  return {
    agglomerates: filteredAgglomerates,
    synapses: filteredSynapses,
    connectomeFile,
  };
};

const defaultFilters: ConnectomeFiltersType = {
  synapseTypes: [],
  synapseDirections: ["in", "out"],
};

type Props = {
  connectomeData: ConnectomeData | null | undefined;
  availableSynapseTypes: Array<string>;
  onUpdateFilteredConnectomeData: (arg0: ConnectomeData | null | undefined) => void;
  disabled: boolean;
};

// Presentational popover content for editing the filters. All state lives in the
// parent ConnectomeFilters component.
function FilterSettings({
  filters,
  availableSynapseTypes,
  isAnyFilterActive,
  onChangeFilters,
  onReset,
}: {
  filters: ConnectomeFiltersType;
  availableSynapseTypes: Array<string>;
  isAnyFilterActive: boolean;
  onChangeFilters: (update: Partial<ConnectomeFiltersType>) => void;
  onReset: () => void;
}) {
  const synapseDirectionOptions = Object.keys(directionCaptions).map(
    // @ts-expect-error
    (direction: DirectionCaptionsKeys) => ({
      label: directionCaptions[direction],
      value: direction,
    }),
  );
  const synapseTypeOptions = availableSynapseTypes.map((synapseType) => ({
    label: synapseType,
    value: synapseType,
  }));
  return (
    <Flex vertical gap="small" style={{ width: 220 }}>
      <Flex justify="space-between" align="center">
        <Typography.Text strong>Filters</Typography.Text>
        <Button
          type="link"
          size="small"
          onClick={onReset}
          disabled={!isAnyFilterActive}
          style={{ padding: 0 }}
        >
          Reset
        </Button>
      </Flex>
      <Divider size="small" style={{ margin: 0 }} />
      <Flex vertical gap={4}>
        <Typography.Text type="secondary">Synapse Direction</Typography.Text>
        <Checkbox.Group
          options={synapseDirectionOptions}
          value={filters.synapseDirections}
          onChange={(synapseDirections: Array<SynapseDirection>) =>
            onChangeFilters({ synapseDirections })
          }
        />
      </Flex>
      <Flex vertical gap={4}>
        <Typography.Text type="secondary">Synapse Type</Typography.Text>
        <Checkbox.Group
          options={synapseTypeOptions}
          value={filters.synapseTypes}
          onChange={(synapseTypes: Array<string>) => onChangeFilters({ synapseTypes })}
          // Stack the (potentially many) type options vertically and let long lists scroll.
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 160,
            overflowY: "auto",
          }}
        />
      </Flex>
    </Flex>
  );
}

function ConnectomeFilters({
  connectomeData,
  availableSynapseTypes,
  onUpdateFilteredConnectomeData,
  disabled,
}: Props) {
  const [filters, setFilters] = useState<ConnectomeFiltersType>(defaultFilters);

  // Keep the synapse type selection in sync with the available synapse types by
  // adjusting state during render rather than in an effect.
  // See https://react.dev/learn/you-might-not-need-an-effect.
  const [prevAvailableSynapseTypes, setPrevAvailableSynapseTypes] = useState(availableSynapseTypes);
  if (prevAvailableSynapseTypes !== availableSynapseTypes) {
    setPrevAvailableSynapseTypes(availableSynapseTypes);
    setFilters((oldFilters) => ({
      ...oldFilters,
      synapseTypes: [
        // Keep the previously selected types that are still valid ...
        ...oldFilters.synapseTypes.filter((type) => availableSynapseTypes.includes(type)),
        // ... and select any newly added types.
        ...availableSynapseTypes.filter((type) => !prevAvailableSynapseTypes.includes(type)),
      ],
    }));
  }

  // Push the derived, filtered connectome data up to the parent whenever the
  // source data or the filters change.
  useEffect(() => {
    onUpdateFilteredConnectomeData(
      getFilteredConnectomeData(connectomeData, filters, availableSynapseTypes.length),
    );
  }, [connectomeData, filters, availableSynapseTypes.length, onUpdateFilteredConnectomeData]);

  const resetFilters = () => {
    setFilters({ ...defaultFilters, synapseTypes: availableSynapseTypes });
  };

  const changeFilters = (update: Partial<ConnectomeFiltersType>) => {
    setFilters((oldFilters) => ({ ...oldFilters, ...update }));
  };

  const isSynapseTypeFilterAvailable = availableSynapseTypes.length;
  const isSynapseTypeFiltered = filters.synapseTypes.length !== availableSynapseTypes.length;
  const isSynapseDirectionFiltered =
    filters.synapseDirections.length !== defaultFilters.synapseDirections.length;
  const isAnyFilterActive = isSynapseTypeFiltered || isSynapseDirectionFiltered;

  return (
    <Tooltip title="Configure Filters">
      <Popover
        content={() => (
          <FilterSettings
            filters={filters}
            availableSynapseTypes={availableSynapseTypes}
            isAnyFilterActive={isAnyFilterActive}
            onChangeFilters={changeFilters}
            onReset={resetFilters}
          />
        )}
        trigger="click"
      >
        <ButtonComponent
          disabled={disabled || !isSynapseTypeFilterAvailable}
          icon={
            <FilterOutlined
              style={
                isAnyFilterActive
                  ? {
                      color: "red",
                    }
                  : {}
              }
            />
          }
          title="Configure Filters"
          variant="text"
          color="default"
        />
      </Popover>
    </Tooltip>
  );
}

export default ConnectomeFilters;
