# Managing Tasks and Projects

webKnossos includes a powerful task and project management system to efficiently annotate large datasets. Large annotations can be broken down into smaller workpieces and distributed to members of your organization. ("Divide and conquer approach")

## Concepts

- `Task`: Is an assignment for a small piece of work. A *Team Manager* or *Admin* creates *Tasks* with information about the *Task Type*, the referenced dataset, starting positions, and advanced options. These tasks will be distributed to eligible users. 
- `Task Instance`: Some *Tasks* need to be completed redundantly by multiple users to assure quality. The single assignments of the tasks are called Instances.
- `Task Type`: Contains a blueprint for *Tasks*. Includes metadata, such as a description with instructions, allowed annotation modes, and advanced options.
- `Project`: A group of many related Tasks is called a *Project*. Projects have a priority assigned to them which affects the order of assignment to users. Projects may be paused and resumed to manage the user workloads and priorities.
- `Experience`: *Admins* and *Team Managers* can assign experience levels to users. *Experiences* are defined by a domain and a value, such as `flight-annotation` and `100`. Tasks specify the required experience level of a user.

It is possible to download all annotations that belong to either a *Project* or a *Task Type* for further processing.

![Video: Managing Projects and Tasks](https://www.youtube.com/watch?v=YC4vaia6MkY)

## How To Create Tasks

First, a *Task Type* needs to be created:
1. Open the `Task Types` screen of the admin section and click on `Add Task Type`.
2. Fill out the form to create the Task Type:
    - Note that the `Description` field supports Markdown formatting.
    - If you don't have a sophisticated team structure, select the [default Team](./users.md#organizations).

![Create a Task Type](./images/tasks_tasktype.png)

Next, you need to set up a *Project*:
1. Open the `Projects` screen of the admin section and click on `Add Project`.
2. Fill out the form to create the *Project*.
    - Note that you can assign a `Priority` to the Project.
    - A higher value means that Tasks from this Project will be more likely to be assigned to users.
    - With the `Time Limit` property, you can specify the expected completion time of a Task Instance.
    - There will be an email notification if users exceed this limit.

![Create a Project](./images/tasks_project.png)

Now, you are ready to create *Tasks*:
1. Open the `Tasks` screen of the admin section and click on `Add Task`.
2. Fill out the form create the Task.
    - Enter the starting positions in the lower part of the form.
    - Alternatively, you can upload an NML file that contains nodes that will be used as starting positions.

Tasks can also be created in bulk using the advanced CSV text input. Not recommended for beginners.

![Create a Task](./images/tasks_task.png)

!!!info
    Note that you need to specify required *Experiences* for a *Task*. Your *Task* can only be assigned if there are users that have the required *Experience* assigned to them.

    You can assign an Experience to a user on the `Users` screen.

    ![Assigning Experiences to users](./images/users_experience.png)

After your *Task* is created, other users in your organization can request *Tasks* from their dashboard (*My Tasks* Tab). 
If there are no other projects with high priorities, they will eventually get your *Task* assigned.
Once a user is done working on a task, they can mark the task as `Finished`.

![Requesting Tasks in the Dashboard](./images/dashboard_tasks.png)

Finally, you can collect and review the completed data of all annotations within a project:
1. Navigate to the `Project` page
2. Select to *View* or *Download* all the combined annotations.

![Download all Tasks of a Project](./images/tasks_download.png)

![Video: Focused Annotation and High-Speed Tasks](https://www.youtube.com/watch?v=2A3en7Kxl3M)

## Task Assignment Criteria
When users request a new task from their dashboard ("My Tasks" tab), a set of criteria is matched to assign them to a fitting task:

- Available *Tasks* are assigned to users that have the required *Experience* and are members of the specified team
- Multiple *Task* Instances will be assigned to different users
- *Tasks* from *Projects* with high priority are assigned first
- *Tasks* from paused *Projects* are not assigned at all
- If there are multiple *Tasks* with the same priority, they will be chosen at random

