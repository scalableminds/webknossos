import { getProjects } from "admin/rest_api";
import { Select } from "antd";
import { useFetch } from "libs/react_helpers";
import { isUserAdminOrTeamManager } from "libs/utils";
import { AnnotationStateFilterEnum, AnnotationTypeFilterEnum } from "oxalis/constants";
import { useWkSelector } from "oxalis/store";
import type React from "react";
import { useEffect, useState } from "react";

type ProjectAndTypeDropdownProps = {
  selectedProjectIds: string[];
  setSelectedProjectIds: (projectIds: string[]) => void;
  selectedAnnotationType: AnnotationTypeFilterEnum;
  setSelectedAnnotationType: (type: AnnotationTypeFilterEnum) => void;
  selectedAnnotationState: string;
  setSelectedAnnotationState: (state: AnnotationStateFilterEnum) => void;

  style?: React.CSSProperties;
};

type NestedSelectOptions = {
  label: string;
  options: Array<{
    label: string;
    value: string;
  }>;
};

const ANNOTATION_TYPE_FILTERS: NestedSelectOptions = {
  label: "Filter types",
  options: [
    { label: "Tasks & Annotations", value: AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY },
    { label: "Annotations", value: AnnotationTypeFilterEnum.ONLY_ANNOTATIONS_KEY },
    { label: "Tasks", value: AnnotationTypeFilterEnum.ONLY_TASKS_KEY },
  ],
};

const ANNOTATION_STATE_FILTERS: NestedSelectOptions = {
  label: "Filter by state",
  options: [
    { label: "Active", value: AnnotationStateFilterEnum.ACTIVE },
    { label: "Finished / Archived", value: AnnotationStateFilterEnum.FINISHED_OR_ARCHIVED },
  ],
};

function ProjectAndAnnotationTypeDropdown({
  selectedProjectIds,
  setSelectedProjectIds,
  selectedAnnotationType,
  setSelectedAnnotationType,
  selectedAnnotationState,
  setSelectedAnnotationState,
  style,
}: ProjectAndTypeDropdownProps) {
  // This state property is derived from selectedProjectIds and selectedAnnotationType.
  // It is mainly used to determine the selected items in the multiselect form item.
  const [selectedFilters, setSelectedFilters] = useState(Array<string>);
  const [filterOptions, setFilterOptions] = useState<Array<NestedSelectOptions>>([]);
  const activeUser = useWkSelector((state) => state.activeUser);
  const allProjects = useFetch(
    async () => {
      if (activeUser == null || !isUserAdminOrTeamManager(activeUser)) return [];
      return await getProjects();
    },
    [],
    [],
  );

  useEffect(() => {
    const selectedKeys =
      selectedAnnotationState !== AnnotationStateFilterEnum.ALL ? [selectedAnnotationState] : [];
    if (selectedProjectIds.length > 0) {
      setSelectedFilters([...selectedProjectIds, ...selectedKeys]);
    } else {
      setSelectedFilters([selectedAnnotationType, ...selectedKeys]);
    }
  }, [selectedProjectIds, selectedAnnotationType, selectedAnnotationState]);

  useEffect(() => {
    const projectOptions = allProjects.map((project) => {
      return {
        label: project.name,
        value: project.id,
      };
    });
    let allOptions = [ANNOTATION_TYPE_FILTERS, ANNOTATION_STATE_FILTERS];
    if (projectOptions.length > 0) {
      allOptions.push({ label: "Filter projects (only tasks)", options: projectOptions });
    }
    setFilterOptions(allOptions);
  }, [allProjects]);

  const setSelectedProjects = async (_prevSelection: string[], selectedValue: string) => {
    if (Object.values<string>(AnnotationStateFilterEnum).includes(selectedValue)) {
      setSelectedAnnotationState(selectedValue as AnnotationStateFilterEnum);
      return;
    }
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
    } else if (Object.values<string>(AnnotationStateFilterEnum).includes(removedKey)) {
      setSelectedAnnotationState(AnnotationStateFilterEnum.ALL);
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
      optionFilterProp="label"
      value={selectedFilters}
      popupMatchSelectWidth={400}
      onDeselect={(removedKey: string) => onDeselect(removedKey)}
      onSelect={(newSelection: string) => setSelectedProjects(selectedFilters, newSelection)}
    />
  );
}

export default ProjectAndAnnotationTypeDropdown;
