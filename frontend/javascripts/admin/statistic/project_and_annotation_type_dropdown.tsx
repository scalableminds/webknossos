import { Select } from "antd";
import React from "react";
import { useEffect, useState } from "react";
import { AnnotationTypeFilterEnum } from "./time_tracking_overview";
import { getProjects } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";
import { isUserAdminOrTeamManager } from "libs/utils";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import * as Utils from "libs/utils";

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
  const ANNOTATION_TYPE_FILTERS: NestedSelectOptions = {
    // TODO lager mich aus ins modul
    label: "Filter types",
    options: [
      { label: "Tasks & Annotations", value: AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY },
      { label: "Annotations", value: AnnotationTypeFilterEnum.ONLY_ANNOTATIONS_KEY },
      { label: "Tasks", value: AnnotationTypeFilterEnum.ONLY_TASKS_KEY },
    ],
  };
  // This state property is derived from selectedProjectIds and selectedAnnotationType.
  // It is mainly used to determine the selected items in the multiselect form item.
  const [selectedFilters, setSelectedFilters] = useState(Array<string>);
  const [filterOptions, setFilterOptions] = useState<Array<NestedSelectOptions>>([]);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const allProjects = useFetch(
    async () => {
      if (activeUser == null || !isUserAdminOrTeamManager(activeUser)) return [];
      return await getProjects();
    },
    [],
    [],
  );

  useEffect(() => {
    if (selectedProjectIds.length > 0) {
      setSelectedFilters(selectedProjectIds);
    } else {
      setSelectedFilters([selectedAnnotationType]);
    }
  }, [selectedProjectIds, selectedAnnotationType]);

  useEffect(() => {
    const projectOptions = allProjects.map((project) => {
      return {
        label: project.name,
        value: project.id,
      };
    });
    let allOptions = [ANNOTATION_TYPE_FILTERS];
    if (projectOptions.length > 0) {
      allOptions.push({ label: "Filter projects (only tasks)", options: projectOptions });
    }
    setFilterOptions(allOptions);
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
    if (Utils.values(AnnotationTypeFilterEnum).includes(removedKey)) {
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
      options={filterOptions}
      value={selectedFilters}
      onDeselect={(removedProjectId: string) => onDeselect(removedProjectId)}
      onSelect={(newSelection: string) => setSelectedProjects(selectedFilters, newSelection)}
    />
  );
}

export default ProjectAndAnnotationTypeDropdown;
