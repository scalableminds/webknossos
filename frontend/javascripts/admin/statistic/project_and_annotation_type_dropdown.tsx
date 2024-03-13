import { Select } from "antd";
import React from "react";
import { useEffect, useState } from "react";
import { AnnotationTypeFilterEnum } from "./time_tracking_overview";
import { getActiveUser, getProjects } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";
import { isUserAdminOrTeamManager } from "libs/utils";

type ProjectAndTypeDropdownProps = {
  selectedProjectIds: string[];
  setSelectedProjectIds: (projectIds: string[]) => void;
  selectedAnnotationType: AnnotationTypeFilterEnum;
  setSelectedAnnotationType: (type: AnnotationTypeFilterEnum) => void;
  style?: React.CSSProperties;
};

type NestedSelectOptions = {
  label: string;
  options: Array<{
    label: string;
    value: string;
  }>;
};

function ProjectAndAnnotationTypeDropdown({
  selectedProjectIds,
  setSelectedProjectIds,
  selectedAnnotationType,
  setSelectedAnnotationType,
  style,
}: ProjectAndTypeDropdownProps) {
  // This state property is an incomplete union of selectedProjectIds and selectedAnnotaionType.
  // It is mainly used to determine the selected items in the multiselect form item.
  const [selectedProjectOrTypeFilters, setSelectedProjectOrTypeFilters] = useState(Array<string>);
  const [taskFilterOptions, setTaskFilterOptions] = useState<Array<NestedSelectOptions>>([]);
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

  useEffect(() => {
    const annotationTypeFilters: NestedSelectOptions = {
      label: "Filter types",
      options: [
        { label: "Tasks & Annotations", value: AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY },
        { label: "Annotations", value: AnnotationTypeFilterEnum.ONLY_ANNOTATIONS_KEY },
        { label: "Tasks", value: AnnotationTypeFilterEnum.ONLY_TASKS_KEY },
      ],
    };
    const projectOptions = allProjects.map((project) => {
      return {
        label: project.name,
        value: project.id,
      };
    });
    let allOptions = [annotationTypeFilters];
    if (projectOptions.length > 0) {
      allOptions.push({ label: "Filter projects (only tasks)", options: projectOptions });
    }
    setTaskFilterOptions(allOptions);
  }, [allProjects]);

  const setSelectedProjects = async (_prevSelection: string[], selectedValue: string) => {
    if (Object.values<string>(AnnotationTypeFilterEnum).includes(selectedValue)) {
      setSelectedAnnotationType(selectedValue as AnnotationTypeFilterEnum);
      setSelectedProjectIds([]);
    } else {
      setSelectedAnnotationType(AnnotationTypeFilterEnum.ONLY_TASKS_KEY);
      setSelectedProjectIds([...selectedProjectIds, selectedValue]);
    }
  };

  const onDeselect = (removedKey: string) => {
    if (Object.values<string>(AnnotationTypeFilterEnum).includes(removedKey)) {
      setSelectedAnnotationType(AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY);
    } else {
      setSelectedProjectIds(selectedProjectIds.filter((projectId) => projectId !== removedKey));
    }
  };

  return (
    <Select
      className="project-and-annotation-type-dropdown"
      mode="multiple"
      placeholder="Filter type or projects"
      style={style}
      options={taskFilterOptions}
      value={selectedProjectOrTypeFilters}
      onDeselect={(removedProjectId: string) => onDeselect(removedProjectId)}
      onSelect={(newSelection: string) =>
        setSelectedProjects(selectedProjectOrTypeFilters, newSelection)
      }
    />
  );
}

export default ProjectAndAnnotationTypeDropdown;
