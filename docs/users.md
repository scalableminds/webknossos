# Managing Users & Access Rights

webKnossos offers a built-in user management system with different user roles.


## Organizations
- explain default orga
- structure: orga -> team -> user


## Access Rights / Roles

There are three different roles for webKnossos users:

  - __Users:__ A basic user of webKnossos. Is able to work on tasks that are assigned to him and create explorational tracings.

  - __Team Manager:__ Manages a specific team. Is able to administrate tasks/taskTypes/projects belonging to that specific team. Is also allowed to activate new users.

  - __Admin:__ Manages the whole organization with all teams. Is able to do the same things as the team manager, but across teams. Admins can also give admin permissions to other users by using the `Grant Admin Rights` button at the top of the user list.


## Registering New Users

New users can signup for webKnossos by clicking on the `Register Now!` button in the navigation bar.
In the registration form, they need to select your organization, specify some basic information and confirm acceptance of the privacy agreement.

{% hint style='info' %}
You can invite users to your specific organization, by clicking the `Invite Users` button at the top of the user list. This will open a popup containing a specially crafted link that you can share to invite new users to your organization.
Users that click on this link, don't need to select an organization during signup and are automatically registered for your organization.
{% endhint %}


## Activating New Users

Newly registered users are deactivated at first and need to be activated by an admin or a team manager.
By default, the user list only shows active users, so make sure to deactivate the `Show Active Users Only` filter at the top of the user list to activate new users.
However, deactivated users that registered in the last 14 days, will be shown above the user list regardlessly and can be activated quickly from there.
When activating a new user, a popup is opened that allows
  - to assign that user to specific teams
  - to pick whether the user should be a team manager or not


## Password Reset / Change Email Address

Users can _change_ their password if they're logged in, by clicking on their username in the top-right corner and selecting `Change Password`. They'll have to provide their current password and can then select a new one.

If they forgot their password, users can _reset_ their password by clicking on `Forgot Password` in the top-right corner when logged out. They'll have to provide their registered email address and will be sent an email containing a token and instructions to reset their password.

Admins can change the email address of users in the user list. Select the Edit icon next to the user's email address, enter the new email address and confirm the change. Remember to let the user know about the successful change of the email address, so the user is still able to log in using the new email address.
