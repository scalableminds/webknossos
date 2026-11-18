import { getProjects, getTaskTypes } from "admin/rest_api";
import { Alert, Steps, type StepsProps, theme } from "antd";
import { useQueryWithErrorHandling } from "libs/react_hooks";

type StepStatus = NonNullable<StepsProps["status"]>;

// Done steps are "finish", the first open step is "process" and all later ones "wait".
function getStepStatuses(doneFlags: boolean[]): StepStatus[] {
  const firstOpenIndex = doneFlags.indexOf(false);
  return doneFlags.map((isDone, index) =>
    isDone ? "finish" : index === firstOpenIndex ? "process" : "wait",
  );
}

function CreateLink({ href, children }: { href: string; children: string }) {
  // A new tab keeps the task form open. The queries below refetch once this tab is focused again.
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/*
 * Explains the order in which new users have to create things before they can create tasks.
 * Only shown while the organization has no task type or no project yet.
 */
export default function TaskSetupGuide() {
  const { token } = theme.useToken();
  // Same keys as in the task form, so both share the cache. Refetching on focus also updates
  // the form's dropdowns once the user returns from creating a task type or project.
  const { data: taskTypes } = useQueryWithErrorHandling({
    queryKey: ["taskTypes"],
    queryFn: getTaskTypes,
    refetchOnWindowFocus: true,
  });
  const { data: projects } = useQueryWithErrorHandling({
    queryKey: ["projects"],
    queryFn: getProjects,
    refetchOnWindowFocus: true,
  });

  if (taskTypes == null || projects == null) {
    return null;
  }
  const hasTaskType = taskTypes.length > 0;
  const hasProject = projects.length > 0;
  if (hasTaskType && hasProject) {
    return null;
  }

  const [taskTypeStatus, projectStatus, tasksStatus] = getStepStatuses([
    hasTaskType,
    hasProject,
    false,
  ]);
  return (
    <Alert
      type="info"
      showIcon
      // Aligns with the padded task forms below, which provide the spacing underneath.
      style={{ margin: `${token.paddingLG}px ${token.paddingLG}px 0` }}
      title="Before creating your first tasks"
      description={
        <Steps
          size="small"
          style={{ marginTop: 8 }}
          items={[
            {
              title: "Task type",
              status: taskTypeStatus,
              content: hasTaskType ? (
                "Done."
              ) : (
                <>
                  <CreateLink href="/taskTypes/create">Create a task type</CreateLink>: the
                  instructions and tools for annotators.
                </>
              ),
            },
            {
              title: "Project",
              status: projectStatus,
              content: hasProject ? (
                "Done."
              ) : (
                <>
                  <CreateLink href="/projects/create">Create a project</CreateLink>: decides who
                  gets the tasks and in which order.
                </>
              ),
            },
            {
              title: "Tasks",
              status: tasksStatus,
              content: "Then create tasks on this page.",
            },
          ]}
        />
      }
    />
  );
}
