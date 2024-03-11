import { Select } from "antd";
import React, { useEffect, useState } from "react";
import { TypeFilters } from "./time_tracking_overview";
import { APIProject } from "types/api_flow_types";

export const getTaskFilterOptions = (allProjects: APIProject[]) => {
  const additionalProjectFilters = {
    label: "Filter types",
    options: [
      { label: "Tasks & Annotations", value: TypeFilters.TASKS_AND_ANNOTATIONS_KEY },
      { label: "Annotations", value: TypeFilters.ONLY_ANNOTATIONS_KEY },
      { label: "Tasks", value: TypeFilters.ONLY_TASKS_KEY },
    ],
  };
  const mappedProjects = allProjects.map((project) => {
    return {
      label: project.name,
      value: project.id,
    };
  });
  return [
    additionalProjectFilters,
    { label: "Filter projects (only tasks)", options: mappedProjects },
  ];
};

function ProjectAndTypeDropdown({
  allProjects,
  setSelectedProjectIdsInParent,
  setAnnotationTypeInParent,
  style,
}) {
  const [selectedProjectOrTypeFilters, setSelectedProjectOrTypeFilters] = useState(Array<string>);
  const [selectedProjectIds, setSelectedProjectIds] = useState(Array<string>);
  const [selectedTypes, setSelectedTypes] = useState("Task,Explorational");
  useEffect(() => {
    if (selectedProjectIds.length > 0) {
      setSelectedProjectOrTypeFilters(selectedProjectIds);
    } else {
      setSelectedProjectOrTypeFilters([selectedTypes]);
    }
  }, [selectedProjectIds, selectedTypes]);
  const setSelectedProjects = (_prevSelection: string[], selectedValue: string) => {
    if (Object.values<string>(TypeFilters).includes(selectedValue)) {
      setAnnotationTypeInParent(selectedValue);
      setSelectedTypes(selectedValue);
      setSelectedProjectIdsInParent([]);
      setSelectedProjectIds([]);
    } else {
      setAnnotationTypeInParent(TypeFilters.ONLY_TASKS_KEY);
      setSelectedTypes(TypeFilters.ONLY_TASKS_KEY);
      setSelectedProjectIdsInParent([...selectedProjectIds, selectedValue]);
      setSelectedProjectIds([...selectedProjectIds, selectedValue]);
    }
  };

  const onDeselect = (removedKey: string) => {
    if ((Object.values(TypeFilters) as string[]).includes(removedKey)) {
      setSelectedTypes(TypeFilters.TASKS_AND_ANNOTATIONS_KEY);
      setAnnotationTypeInParent(TypeFilters.TASKS_AND_ANNOTATIONS_KEY);
    } else {
      setSelectedProjectIdsInParent(
        selectedProjectIds.filter((projectId) => projectId !== removedKey),
      );
      setSelectedProjectIds(selectedProjectIds.filter((projectId) => projectId !== removedKey));
    }
  };
  return (
    <Select
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

export default ProjectAndTypeDropdown;
