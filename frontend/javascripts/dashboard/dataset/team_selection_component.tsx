import { getEditableTeams, getTeams } from "admin/rest_api";
import { Select } from "antd";
import { useEffectOnlyOnce } from "libs/react_hooks";
import _ from "lodash";
import { useCallback, useEffect, useState } from "react";
import type { APITeam } from "types/api_types";

const { Option } = Select;

type TeamSelectionComponentProps = {
  value?: APITeam | Array<APITeam>;
  onChange?: (value: APITeam | Array<APITeam>) => void;
  afterFetchedTeams?: (arg0: Array<APITeam>) => void;
  mode?: "tags" | "multiple" | undefined;
  allowNonEditableTeams?: boolean;
  disabled?: boolean;
};

function TeamSelectionComponent({
  value,
  onChange,
  afterFetchedTeams,
  mode,
  allowNonEditableTeams,
  disabled,
}: TeamSelectionComponentProps) {
  const [possibleTeams, setPossibleTeams] = useState<APITeam[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<APITeam[]>(value ? _.flatten([value]) : []);
  const [isFetchingData, setIsFetchingData] = useState(false);

  // Sync selectedTeams with value
  useEffect(() => {
    setSelectedTeams(value ? _.flatten([value]) : []);
  }, [value]);

  // Fetch teams on mount
  useEffectOnlyOnce(() => {
    fetchData();
  });

  async function fetchData() {
    setIsFetchingData(true);
    try {
      const possibleTeams = allowNonEditableTeams ? await getTeams() : await getEditableTeams();
      setPossibleTeams(possibleTeams);
      setIsFetchingData(false);
      if (afterFetchedTeams) {
        afterFetchedTeams(possibleTeams);
      }
    } catch (_exception) {
      console.error("Could not load teams.");
    }
  }

  const getAllTeams = useCallback((): APITeam[] => {
    return _.unionBy(possibleTeams, selectedTeams, (t) => t.id);
  }, [possibleTeams, selectedTeams]);

  const onSelectTeams = (selectedTeamIdsOrId: string | Array<string>) => {
    const selectedTeamIds = Array.isArray(selectedTeamIdsOrId)
      ? selectedTeamIdsOrId
      : [selectedTeamIdsOrId];
    const allTeams = getAllTeams();
    const selected = _.compact(selectedTeamIds.map((id) => allTeams.find((t) => t.id === id)));
    if (onChange) {
      onChange(Array.isArray(selectedTeamIdsOrId) ? selected : selected[0]);
    }
    setSelectedTeams(selected);
  };

  return (
    <Select
      showSearch
      mode={mode}
      style={{ width: "100%" }}
      placeholder={mode && mode === "multiple" ? "Select Teams" : "Select a Team"}
      optionFilterProp="children"
      onChange={onSelectTeams}
      value={selectedTeams.map((t) => t.id)}
      filterOption
      disabled={disabled ? disabled : false}
      loading={isFetchingData}
    >
      {getAllTeams().map((team) => (
        <Option disabled={possibleTeams.find((t) => t.id === team.id) == null} key={team.id}>
          {team.name}
        </Option>
      ))}
    </Select>
  );
}

export default TeamSelectionComponent;
