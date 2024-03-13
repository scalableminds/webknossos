import { Select } from "antd";
import React, { useEffect, useState } from "react";
import { AnnotationTypeFilters } from "./time_tracking_overview";
import { APIProject } from "types/api_flow_types";
import { getActiveUser, getProjects } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";
import { isUserAdminOrTeamManager } from "libs/utils";

type ProjectAndTypeDropdownProps = {
  selectedProjectIds: string[];
  setSelectedProjectIdsInParent: (projectIds: string[]) => void;
  selectedAnnotationType: AnnotationTypeFilters;
  setSelectedAnnotationTypeInParent: (type: AnnotationTypeFilters) => void;
  style?: {};
};

function ProjectAndAnnotationTypeDropdown({
  selectedProjectIds,
  setSelectedProjectIdsInParent,
  selectedAnnotationType,
  setSelectedAnnotationTypeInParent,
  style,
}: ProjectAndTypeDropdownProps) {
  const [selectedProjectOrTypeFilters, setSelectedProjectOrTypeFilters] = useState(Array<string>);
  const allProjects = useFetch(
    async () => {
      const activeUser = await getActiveUser();
      if (!isUserAdminOrTeamManager(activeUser)) return [];
      return await getProjects();
    },
    [],
    [],
  );

  useEffect(() => {
    if (selectedProjectIds.length > 0) {
      setSelectedProjectOrTypeFilters(selectedProjectIds);
    } else {
      setSelectedProjectOrTypeFilters([selectedAnnotationType]);
    }
  }, [selectedProjectIds, selectedAnnotationType]);

  const getTaskFilterOptions = (allProjects: APIProject[]) => {
    const additionalProjectFilters: {
      label: string;
      options: Array<{ label: string; value: string }>;
    } = {
      label: "Filter types",
      options: [
        { label: "Tasks & Annotations", value: AnnotationTypeFilters.TASKS_AND_ANNOTATIONS_KEY },
        { label: "Annotations", value: AnnotationTypeFilters.ONLY_ANNOTATIONS_KEY },
        { label: "Tasks", value: AnnotationTypeFilters.ONLY_TASKS_KEY },
      ],
    };
    const mappedProjects = allProjects.map((project) => {
      return {
        label: project.name,
        value: project.id,
      };
    });
    let allOptions = [additionalProjectFilters];

    if (mappedProjects.length > 0) {
      allOptions.push({ label: "Filter projects (only tasks)", options: mappedProjects });
    }
    return allOptions;
  };

  const setSelectedProjects = async (_prevSelection: string[], selectedValue: string) => {
    if (Object.values<string>(AnnotationTypeFilters).includes(selectedValue)) {
      setSelectedAnnotationTypeInParent(selectedValue as AnnotationTypeFilters);
      setSelectedProjectIdsInParent([]);
    } else {
      setSelectedAnnotationTypeInParent(AnnotationTypeFilters.ONLY_TASKS_KEY);
      setSelectedProjectIdsInParent([...selectedProjectIds, selectedValue]);
    }
  };

  const onDeselect = (removedKey: string) => {
    if ((Object.values(AnnotationTypeFilters) as string[]).includes(removedKey)) {
      setSelectedAnnotationTypeInParent(AnnotationTypeFilters.TASKS_AND_ANNOTATIONS_KEY);
    } else {
      setSelectedProjectIdsInParent(
        selectedProjectIds.filter((projectId) => projectId !== removedKey),
      );
    }
  };

  return (
    <Select
      className="project-and-annotation-type-dropdown"
      mode="multiple"
      placeholder="Filter type or projects"
      style={style}
      options={getTaskFilterOptions(allProjects)}
      value={selectedProjectOrTypeFilters}
      onDeselect={(removedProjectId: string) => onDeselect(removedProjectId)}
      onSelect={(newSelection: string) =>
        setSelectedProjects(selectedProjectOrTypeFilters, newSelection)
      }
    />
  );
}

export default ProjectAndAnnotationTypeDropdown;
