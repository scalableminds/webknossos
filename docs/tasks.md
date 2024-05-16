# Managing Tasks and Projects

WEBKNOSSOS includes a powerful task and project management system to efficiently annotate large datasets. Large annotations can be broken down into smaller workpieces and distributed to members of your organization. ("Divide and conquer approach")

The task systems is designed for automated task distribution to a (large) group of annotators based on several criteria, e.g., experience, access rights, etc. For fine-grained control, manual task assignments are also possible.

## Concepts

- `Task`: Is an assignment for a small piece of work. A _Team Manager_ or _Admin_ creates _Tasks_ with information about the _Task Type_, the referenced dataset, starting positions, and advanced options. These tasks will be distributed to eligible users.
- `Task Instance`: Some _Tasks_ need to be completed redundantly by multiple users to assure quality. The single assignments of the tasks are called Instances.
- `Task Type`: Contains a blueprint for _Tasks_. Includes metadata, such as a description with instructions, allowed annotation modes, and advanced options.
- `Project`: A group of many related Tasks is called a _Project_. Projects have a priority assigned to them which affects the order of assignment to users. Projects may be paused and resumed to manage the user workloads and priorities.
- `Experience`: _Admins_ and _Team Managers_ can assign experience levels to users. _Experiences_ are defined by a domain and a value, such as `flight-annotation` and `100`. Tasks specify the required experience level of a user.

It is possible to download all annotations that belong to either a _Project_ or a _Task Type_ for further processing.

![youtube-video](https://www.youtube.com/embed/YC4vaia6MkY)

## How To Create Tasks

First, a _Task Type_ needs to be created:

1. Open the `Task Types` screen of the administration section and click on `Add Task Type`.
2. Fill out the form to create the Task Type:
   - Note that the `Description` field supports Markdown formatting.
   - If you don't have a sophisticated team structure, select the [default Team](./users.md#organizations).

![Create a Task Type](./images/tasks_tasktype.jpeg)

Next, you need to set up a _Project_:

1. Open the `Projects` screen of the administration section and click on `Add Project`.
2. Fill out the form to create the _Project_.
   - Note that you can assign a `Priority` to the Project. A higher value means that Tasks from this Project will be more likely to be assigned to users.
   - With the `Time Limit` property, you can specify the expected completion time of a Task Instance. There will be an email notification if users exceed this limit.

![Create a Project](./images/tasks_project.jpeg)

Now, you are ready to create _Tasks_:

1. Open the `Tasks` screen of the administration section and click on `Add Task`.
2. Fill out the form create the Task.
   - Enter the starting positions in the lower part of the form.
   - Alternatively, you can upload an NML file that contains nodes that will be used as starting positions.

Tasks can also be created in bulk using the advanced CSV text input. Not recommended for beginners.

![Create a Task](./images/tasks_task.jpeg)

**Note that you need to specify required _Experiences_ for a _Task_. Your _Task_ can only be assigned if there are users that have the required _Experience_ assigned to them. You can assign an Experience to a user on the `Users` screen.**

![Assigning Experiences to users](./images/users_experience.jpeg)

After your _Task_ is created, other users in your organization can request _Tasks_ from their dashboard (_Tasks_ tab).
If there are no other projects with high priorities, they will eventually get your _Task_ assigned.
Alternatively, you can manually assign a task to individual users (see below).
Once a user is done working on a task, they can mark the task as `Finished`.

![Requesting Tasks in the Dashboard](./images/dashboard_tasks.jpeg)

Finally, you can collect and review the completed data of all annotations within a project:

1. Navigate to the `Project` page
2. Select to _View_ or _Download_ all the combined annotations.

![Download all Tasks of a Project](./images/tasks_download.jpeg)

![youtube-video](https://www.youtube.com/embed/2A3en7Kxl3M)

## Task Assignment Criteria

When users request a new task from their dashboard ("Tasks" tab), a set of criteria is matched to assign them to a fitting task:

- Available _Tasks_ are assigned to users that have the required _Experience_ and are members of the specified team
- Multiple _Task_ Instances will be assigned to different users
- _Tasks_ from _Projects_ with high priority are assigned first
- _Tasks_ from paused _Projects_ are not assigned at all
- If there are multiple _Tasks_ with the same priority, they will be chosen at random

## Manual Task Assignment

In contrast to the automated task distribution system, an admin user can also manually assign a task instance to users.
Note, manual assignments bypass the assignment criteria enforced by the automated system and allow for fine-grained and direct assignments to individual user.

Manual assignments can be done by:

1. Navigate to the task list
2. Search for your task by setting the appropriate filters
3. Click on "Manual Assign To User"
4. Select a user for the assignment from the dropdown
5. Confirm the assignment with "ok"

Existing, active and finished task instances can also be transferred to other users, e.g. for proofreading, continued annotation or to change ownership:

1. Navigate to the task list
2. Search for your task by setting the appropriate filters
3. Expand the list entry for selected task - plus icon - and locate the respective task instance
4. From the `Actions` menu on the right-hand side, select "Transfer"
5. Select a user for the task transferal from the dropdown
6. Confirm the task transfer with "ok"

![Transfer a task instance to a new user and additional task administration actions.](./images/task_instance_actions.jpg)
