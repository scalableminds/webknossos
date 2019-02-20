# Managing Users and Access Rights

webKnossos offers a built-in user management system in order to administer different user roles and permissions.

## Organizations

The root entity in webKnossos is an **organization**. You will create one when setting up webKnossos. This organization will contain all your users, datasets, annotations and other data. Organizations are isolated. You are not allowed to see data from organizations other than your own and members from other organizations will not be able to see data from your organization.

When creating your organization, a default team with the same name will be created. This team is referred to as the **organization team**. Users that register for your organization will, by default, be assigned to that organization team. An organization can contain as many teams as you like. Users can be assigned to multiple teams. Teams are useful for managing dataset access permissions or simply to organize users into logical groups.

![All users, annotations, and datasets belong to an organization. By default, all users are assigned to the organization team. Further teams can be created for fine-grained access permissions.](../.gitbook/assets/teams%20%283%29.png)

## Access Rights / Roles

Users are allowed to access and do different things, depending on their specific role. There are three different roles for webKnossos users:

* **User:** A regular wK user account. Users are able to work on tasks that are assigned to them and create explorational tracings. They are able to access their own annotations.
* **Team Manager:** Manages a specific team. Team Managers are able to administrate [Tasks, Task Types and Projects](tasks.md) belonging to that specific team. They are also allowed to activate newly registered users. Team managers are able to access all tracings that belong to users of their team.
* **Admin:** Manages the whole organization with all teams. Admins are able to do the same things as team managers but across all teams. They can also give admin permissions to other users by using the `Grant Admin Rights` button at the top of the user list. Admins are able to access all tracings that belong to their organization.

Only _Admins_ and _Team managers_ are able to see/access the `Admin` menu options in the navigation bar.

By default, each new dataset can only be accessed by the members of the organization team. Add or remove more teams to a dataset for fine-grained access controls. For more information dataset and access rights, [see the dataset guide](sharing.md#general)

## Registering New Users

New users can signup for webKnossos by clicking on the `Register Now` button in the navigation bar. In the registration form, they need to select an organization, specify some basic information and confirm acceptance of the privacy agreement.

{% hint style="info" %}
You can invite users to your specific organization, by clicking the `Invite Users` button at the top of the user list. This will open a popup containing a customized link that you can share to invite new users to your organization. Users that click on this link, don't need to select an organization during registration and are automatically assigned to your organization.

![Send an invite link to new users](../.gitbook/assets/users_invite%20%282%29.png)
{% endhint %}

## Activating New Users

Newly registered users are deactivated at first and need to be activated by an admin or a team manager. By default, the user list only shows active users, so make sure to deactivate the `Show Active Users Only` filter at the top of the user list to activate new users. However, deactivated users that registered in the last 14 days, will be shown above the user list regardlessly and can be activated quickly from there.

When activating new users, a popup opens for

* team assignment
* access role assignment

![Activate new users](../.gitbook/assets/users_activate1.png) ![Assign roles to new users](../.gitbook/assets/users_activate2%20%283%29.png)

## Password Reset / Change Email Address

Users can _change_ their password by themselves if they are logged in. Password reset can be found by clicking on their username in the navigation bar in the top-right corner of the screen and selecting `Change Password`. Users need to provide their current password and choose a new one.

Logged-out users can _reset_ their password by clicking on `Forgot Password` in the navigation bar in the top-right corner of the screen. They will have to provide their registered email address and will be sent an email containing a token and instructions to reset the password.

Admins can modify the email address of each user from the user administration list. Select the `Edit` icon next to a user's email address, enter the new email address and confirm the change. Remember to inform the user about the successful change of the email address, since the new email address will be used for the login credentials.

