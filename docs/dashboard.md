# Dashboard

The Dashboard is your entry point to webKnossos.
You can manage your datasets, create annotations, resume existing annotations and retrieve tasks distributed to you.

## Datasets
This screen shows all the available and accessible datasets for a user.
You can *view* a dataset (read-only) or start new annotations from this screen.
Search for your dataset by using the search bar or sorting any of the table columns.
Learn more about managing datasets in the [Datasets guide](./datasets.md).

The presentation differs corresponding to your user role.
Regular users can only start or continue annotations and work on tasks.
[Admins and Team Managers](./users.md#access-rights-roles) also have access to additional administration actions, access-rights management, and advanced dataset properties for each dataset.

![Dashboard for Team Managers or Admins with access to dataset settings and additional administration actions.](./images/dashboard_datasets.jpeg)
![Dashboard for Regular Users](./images/dashboard_regular_user.jpeg)

![Video: Community Dataset Gallery & Navigating Through Data](https://www.youtube.com/watch?v=naPL1jfCdOc)

## Tasks

With Tasks, you can coordinate large annotation projects with your users.
Tasks are small annotation work assignments that are automatically distributed to users. This is particularly useful when you have several users in your organization that you can distribute the work to, e.g., working students, scientific assistances, outside collaborators, etc.

On the Task screen, users can request new tasks, continue to work on existing tasks, and finish tasks. These tasks are assigned based on a user's experience level, project priority, and task availability.
Read more about the tasks feature in the [Tasks and Projects guide](./tasks.md).

![Tasks can be distributed to users. Task can include rich instructions.](./images/dashboard_tasks.jpeg)

## Annotations
This screen lists all your annotations (skeleton, volume or both) that you started on a dataset (outside of tasks) and annotations that were shared with you. Annotations are either created by starting new annotations from the "Datasets" tab, from the webKnossos data viewer, or by uploading an existing annotation from your computer (see [NML files](./data_formats.md#nml) for skeleton annotations).

Annotations can be resumed, archived (like delete, but reversible), and downloaded for offline analysis. 
You can also add custom tags to annotations to organize and group them. Click on one or multiple of your tags if you want to filter a particular group of annotations. 
Each annotation can be renamed to reflect its content.

![Manage and resume your skeleton and volume annotations.](./images/dashboard_annotations.jpeg)
![Annotations can archived to declutter your dashboard.](./images/dashboard_archive.jpeg)


### Sharing Annotations
The annotations tab also shows all annotations that were shared by other collaborators of your organization. Only annotations shared through the "Team Sharing" mechanic will be listed provided your user account is part of the respective team. Read more about sharing your own annotations in the [Sharing guide](./sharing.md#annotation-sharing).

You can view the linked annotations (read-only) or copy them to your account for modification.

todo: update image
![Annotations shared with any of your teams are listed on your dashboard too.](./images/shared_annotations_tab.jpeg)

## Featured Publications

This screen lists a number of featured public community datasets and their respective publications hosted by the webKnossos team. Feel free to explore these datasets or to build upon them.

[Contact us](mailto:hello@webknossos.org) if you would like your data and publication to be featured here as well.

![The list of featured community datasets.](./images/dashboard_featured_publications.jpeg)

