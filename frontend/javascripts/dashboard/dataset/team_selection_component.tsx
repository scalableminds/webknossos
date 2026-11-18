import { PlusOutlined, TeamOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { getEditableTeams, getTeams } from "admin/rest_api";
import CreateTeamModalView from "admin/team/create_team_modal_view";
import { Button, Divider, Select } from "antd";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { isUserAdminOrManager } from "libs/utils";
import compact from "lodash-es/compact";
import unionBy from "lodash-es/unionBy";
import type { ReactNode } from "react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { APITeam } from "types/api_types";

type TeamSelectionComponentProps = {
  value?: APITeam | Array<APITeam>;
  onChange?: (value: APITeam | Array<APITeam>) => void;
  afterFetchedTeams?: (arg0: Array<APITeam>) => void;
  mode?: "tags" | "multiple" | undefined;
  allowNonEditableTeams?: boolean;
  // Show "Create new team" / "Add users to teams" actions to admins/managers. Off by default.
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
  allowManagingTeams = false,
  disabled,
  prefix,
}: TeamSelectionComponentProps) {
  const queryClient = useQueryClient();
  const teamsQueryKey = allowNonEditableTeams ? ["teams"] : ["editableTeams"];
  const {
    data: fetchedTeams,
    isPending: isFetchingData,
    isFetchedAfterMount,
  } = useQueryWithErrorHandling(
    {
      queryKey: teamsQueryKey,
      queryFn: () => (allowNonEditableTeams ? getTeams() : getEditableTeams()),
      refetchOnWindowFocus: false,
    },
    "Could not load teams.",
  );
  const possibleTeams = useMemo(() => fetchedTeams ?? [], [fetchedTeams]);
  const [selectedTeams, setSelectedTeams] = useState<APITeam[]>(value ? [value].flat() : []);
  const [isCreateTeamModalOpen, setIsCreateTeamModalOpen] = useState(false);
  const activeUser = useWkSelector((state) => state.activeUser);
  const canCreateTeams = allowManagingTeams === true && isUserAdminOrManager(activeUser);

  // Sync selectedTeams with value
  useEffect(() => {
    setSelectedTeams(value ? [value].flat() : []);
  }, [value]);

  // Notify the parent once after the teams were freshly loaded. Later cache updates (e.g.
  // refetches or a newly created team) must not trigger it again, since the parent may
  // reset the selection in this callback.
  const hasNotifiedAboutFetchedTeams = useRef(false);
  const onTeamsFetched = useEffectEvent((teams: APITeam[]) => afterFetchedTeams?.(teams));
  useEffect(() => {
    if (fetchedTeams != null && isFetchedAfterMount && !hasNotifiedAboutFetchedTeams.current) {
      hasNotifiedAboutFetchedTeams.current = true;
      onTeamsFetched(fetchedTeams);
    }
  }, [fetchedTeams, isFetchedAfterMount]);

  const getAllTeams = useCallback((): APITeam[] => {
    return unionBy(possibleTeams, selectedTeams, (t) => t.id);
  }, [possibleTeams, selectedTeams]);

  const teamOptions = useMemo(
    () =>
      getAllTeams().map((team) => ({
        value: team.id,
        label: team.name,
        disabled: possibleTeams.find((t) => t.id === team.id) == null,
      })),
    [getAllTeams, possibleTeams],
  );

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
    queryClient.setQueryData(teamsQueryKey, (teams: APITeam[] = []) =>
      unionBy(teams, [newTeam], (t) => t.id),
    );
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
        showSearch={{ optionFilterProp: "label", filterOption: true }}
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
        options={teamOptions}
      />
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
