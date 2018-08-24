# Managing Users & Access Rights

webKnossos offers a built-in user management system in order to manage different user roles and permissions.


## Organizations

The root entity in webKnossos is an **organization**.
You will create one when setting up webKnossos.
This organization will contain all your users, datasets, tracings and other data.
Organizations are isolated.
You are not allowed to see data from organizations other than your own and members from other organizations will not be able to see data from your organization.

When creating your organization, a default team with the same name will be created.
This team is referred to as the **organization team**.
Users that register for your organization will, by default, be assigned to that default team.
You are free to create as many teams as you want and to assign users to multiple teams.
Teams can be used to manage dataset access permissions or simply to assign users to logical groups.

![Organizations, Teams and Users](images/teams.png)


## Access Rights / Roles

Users are allowed to access and do different things, depending on their specific role.
There are three different roles for webKnossos users:

  - __Users:__ A basic user of webKnossos. Users are able to work on tasks that are assigned to them and create explorational tracings. They are able to access their own tracings.

  - __Team Manager:__ Manages a specific team. Team Managers are able to administrate [Tasks, Task Types and Projects](./tasks.md) belonging to that specific team. They are also allowed to activate new users. Team managers are able to access all tracings that belong to users of their team.

  - __Admin:__ Manages the whole organization with all teams. Admins are able to do the same things as team managers, but across teams. They can also give admin permissions to other users by using the `Grant Admin Rights` button at the top of the user list. Admins are able to access all tracings that belong to their organization.

## Registering New Users

New users can signup for webKnossos by clicking on the `Register Now` button in the navigation bar.
In the registration form, they need to select your organization, specify some basic information and confirm acceptance of the privacy agreement.

{% hint style='info' %}
You can invite users to your specific organization, by clicking the `Invite Users` button at the top of the user list. This will open a popup containing a customized link that you can share to invite new users to your organization.
Users that click on this link, don't need to select an organization during signup and are automatically registered for your organization.
{% endhint %}


## Activating New Users

Newly registered users are deactivated at first and need to be activated by an admin or a team manager.
By default, the user list only shows active users, so make sure to deactivate the `Show Active Users Only` filter at the top of the user list to activate new users.
However, deactivated users that registered in the last 14 days, will be shown above the user list regardlessly and can be activated quickly from there.

When activating a new user, a popup is opened that allows
  - to assign that user to specific teams
  - to pick whether the user should be a team manager or not

TODO: Image user list with newly created users


## Password Reset / Change Email Address

Users can _change_ their password if they're logged in, by clicking on their username in the top-right corner and selecting `Change Password`. They'll have to provide their current password and can then select a new one.

If they forgot their password, users can _reset_ their password by clicking on `Forgot Password` in the top-right corner when logged out. They'll have to provide their registered email address and will be sent an email containing a token and instructions to reset their password.

Admins can change the email address of users in the user list. Select the `Edit` icon next to the user's email address, enter the new email address and confirm the change. Remember to inform the user about the successful change of the email address, so the user is still able to log in using the new email address.
