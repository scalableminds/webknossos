# Organizations

The root entity in WEBKNOSSOS is an *organization*.
You will create one when setting up WEBKNOSSOS or when signing up for an account on [webknossos.org](https://webknossos.org).
An organization contains all your users, datasets, annotations, and other data.
Organizations are isolated from each other.
You are not allowed to see data from organizations other than your own. 
Members from other organizations will not be able to see data from your organization.

You can invite other users to join your organization and collaborate on datasets. Datasets and annotations are shared between members of an organization. You can finetune access rights to datasets and visibility on the dashboard on various levels.

## Managing Your Organization

Organization settings can be managed from the `Administration > Organization` page. Access is restricted to users with the `Admin` role.

### Overview

The overview tab provides a summary of your organization, including:

- **Name:** The display name of the organization, which can be edited here.
- **Owner:** The user who owns the organization.
- **Plan Details:** Information about your current subscription plan.
- **Storage Usage:** A report on the total disk space used by your organization's datasets.
- **Member Information:** A count of the total users in the organization.
- **WEBKNOSSOS Credits:** The amount of credits available to the organization.

### Notifications

This tab allows admins to configure email notifications for the organization:

- **WEBKNOSSOS Plan & Subscription:** The email address to receive plan and subscription notifications.
- **AI Job Completion:** Configure who receives notifications about completed AI [jobs](../automation/jobs.md).
- **New User Signup:** The email address to receive notifications about new user signups.

### Delete Organization

Deleting an organization will permanently remove all associated data, including annotations, datasets, and user accounts. This action cannot be undone.

Before proceeding:  

- Ensure you have exported any datasets and annotations you need to retain.  
- Only the designated organization Owner (or an Admin with the required permission) may perform this action.  
- Deleted organizations cannot be restored unless a prior backup exists.  

## Switching Organizations
A WEBKNOSSOS user account can be part of more than one organization, .e.g., when your are invited to collaborate on projects of another institute, working as a different WEBKNOSSOS organization.

If you are part of multiple organizations, you can switch between them from the "User avatar" menu. 
Click on your user avatar in the top-right corner of the screen and select an entry from the "Switch Organization" menu.
WEBKNOSSOS will quickly reload and switch your account to that organization, i.e. refresh your dashboard, access permissions, annotations, etc. to match your account in the selected organization.
