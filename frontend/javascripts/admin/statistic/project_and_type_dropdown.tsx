import { Select } from "antd";
import React, { useEffect, useState } from "react";
import { AnnotationTypeFilters } from "./time_tracking_overview";
import { APIProject } from "types/api_flow_types";

export const getTaskFilterOptions = (allProjects: APIProject[]) => {
  const additionalProjectFilters = {
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
  return [
    additionalProjectFilters,
    { label: "Filter projects (only tasks)", options: mappedProjects },
  ];
};

type ProjectAndTypeDropdownProps = {
  allProjects: APIProject[],
  selectedProjectIds: string[],
  setSelectedProjectIdsInParent: (projectIds: string[])=>void,
  selectedAnnotationType: AnnotationTypeFilters,
  setSelectedAnnotationTypeInParent : (type: AnnotationTypeFilters)=>void,
  style: {}
}

function ProjectAndAnnotationTypeDropdown({
  allProjects,
  selectedProjectIds,
  setSelectedProjectIdsInParent,
  selectedAnnotationType,
  setSelectedAnnotationTypeInParent,
  style,
}: ProjectAndTypeDropdownProps) {
  const [selectedProjectOrTypeFilters, setSelectedProjectOrTypeFilters] = useState(Array<string>);
  useEffect(() => {
    if (selectedProjectIds.length > 0) {
      setSelectedProjectOrTypeFilters(selectedProjectIds);
    } else {
      setSelectedProjectOrTypeFilters([selectedAnnotationType]);
    }
  }, [selectedProjectIds, selectedAnnotationType]);
  const setSelectedProjects = (_prevSelection: string[], selectedValue: string) => {
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
      setSelectedProjectIdsInParent(selectedProjectIds.filter((projectId) => projectId !== removedKey));
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

export default ProjectAndAnnotationTypeDropdown;
