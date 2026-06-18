import { PlusOutlined, TeamOutlined } from "@ant-design/icons";
import { getEditableTeams, getTeams } from "admin/rest_api";
import CreateTeamModalView from "admin/team/create_team_modal_view";
import { Button, Divider, Select } from "antd";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { isUserAdminOrManager } from "libs/utils";
import compact from "lodash-es/compact";
import unionBy from "lodash-es/unionBy";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { APITeam } from "types/api_types";

const { Option } = Select;

type TeamSelectionComponentProps = {
  value?: APITeam | Array<APITeam>;
  onChange?: (value: APITeam | Array<APITeam>) => void;
  afterFetchedTeams?: (arg0: Array<APITeam>) => void;
  mode?: "tags" | "multiple" | undefined;
  allowNonEditableTeams?: boolean;
  // Allow admins/managers to create a new team without leaving this component.
  allowManagingTeams?: boolean;
  disabled?: boolean;
  prefix?: ReactNode;
};

function TeamSelectionComponent({
  value,
  onChange,
  afterFetchedTeams,
  mode,
  allowNonEditableTeams,
  allowManagingTeams = true,
  disabled,
  prefix,
}: TeamSelectionComponentProps) {
  const [possibleTeams, setPossibleTeams] = useState<APITeam[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<APITeam[]>(value ? [value].flat() : []);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [isCreateTeamModalOpen, setIsCreateTeamModalOpen] = useState(false);
  const activeUser = useWkSelector((state) => state.activeUser);
  const canCreateTeams = allowManagingTeams === true && isUserAdminOrManager(activeUser);

  // Sync selectedTeams with value
  useEffect(() => {
    setSelectedTeams(value ? [value].flat() : []);
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
      if (afterFetchedTeams) {
        afterFetchedTeams(possibleTeams);
      }
    } catch (_exception) {
      Toast.error("Could not load teams.");
    } finally {
      setIsFetchingData(false);
    }
  }

  const getAllTeams = useCallback((): APITeam[] => {
    return unionBy(possibleTeams, selectedTeams, (t) => t.id);
  }, [possibleTeams, selectedTeams]);

  const onSelectTeams = (selectedTeamIdsOrId: string | Array<string>) => {
    const selectedTeamIds = Array.isArray(selectedTeamIdsOrId)
      ? selectedTeamIdsOrId
      : [selectedTeamIdsOrId];
    const allTeams = getAllTeams();
    const selectedTeams = compact(selectedTeamIds.map((id) => allTeams.find((t) => t.id === id)));
    if (onChange) {
      onChange(Array.isArray(selectedTeamIdsOrId) ? selectedTeams : selectedTeams[0]);
    }
    setSelectedTeams(selectedTeams);
  };

  const onTeamCreated = (newTeam: APITeam) => {
    setIsCreateTeamModalOpen(false);
    setPossibleTeams((teams) => unionBy(teams, [newTeam], (t) => t.id));
    const newSelectedTeams =
      mode === "multiple" ? unionBy(selectedTeams, [newTeam], (t) => t.id) : [newTeam];
    setSelectedTeams(newSelectedTeams);
    if (onChange) {
      onChange(mode === "multiple" ? newSelectedTeams : newTeam);
    }
  };

  return (
    <>
      <Select
        mode={mode}
        style={{ width: "100%" }}
        placeholder={mode && mode === "multiple" ? "Select Teams" : "Select a Team"}
        showSearch={{ optionFilterProp: "children", filterOption: true }}
        onChange={onSelectTeams}
        value={selectedTeams.map((t) => t.id)}
        disabled={disabled ?? false}
        loading={isFetchingData}
        prefix={prefix}
        popupRender={
          canCreateTeams
            ? (menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: "4px 0" }} />
                  <Button
                    type="text"
                    icon={<PlusOutlined />}
                    style={{ width: "100%", textAlign: "left" }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setIsCreateTeamModalOpen(true)}
                  >
                    Create new team
                  </Button>
                  <Button
                    type="text"
                    icon={<TeamOutlined />}
                    href="/teams"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ width: "100%", textAlign: "left" }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    Add users to teams …
                  </Button>
                </>
              )
            : undefined
        }
      >
        {getAllTeams().map((team) => (
          <Option disabled={possibleTeams.find((t) => t.id === team.id) == null} key={team.id}>
            {team.name}
          </Option>
        ))}
      </Select>
      {canCreateTeams && (
        <CreateTeamModalView
          isOpen={isCreateTeamModalOpen}
          onOk={onTeamCreated}
          onCancel={() => setIsCreateTeamModalOpen(false)}
        />
      )}
    </>
  );
}

export default TeamSelectionComponent;
