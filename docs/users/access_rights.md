# Access Rights / Roles

The WEBKNOSSOS permissions system is designed to 1) control read/write access to datasets and 2) limit access to certain administration functionalities.

There are four different roles for WEBKNOSSOS users divided into global, organization-wide roles and team-based permissions:

*On a per team basis:*

  - __Member:__ A regular wK user account. Members are only able to access datasets of their respective teams and can create annotations for those. Further, they can work on tasks created by their `Team Manager` or an `Admin`. They are only able to access their own annotations or [annotations shared with them](../sharing/annotation_sharing.md).

  - __Team Manager:__ Manage a specific team. Team Managers can administrate and create [Tasks, Task Types, and Projects](../tasks_projects/tasks.md) belonging to their respective teams. They also can activate newly registered users and assign/remove users to/from their teams. Team managers can access all annotations belonging to users of their respective teams. Similarly to regular `Members`, they are only able to access datasets of their respective teams and can create annotations for those.

*On an organizational level:*

  - __Admin:__ Manage a whole organization, including full access to all datasets, teams, and projects. Admins can access all administrative settings - similar to `Team Managers` but for all teams - and have full control over all datasets - similar to `Dataset Managers`. They can promote other users to `Admin` or to `Dataset Manager` by using the `Edit Teams and Permissions` dialog at the top of the user list. Admins can access ALL annotations, datasets, projects, tasks, etc belonging to their respective organization and can modify any setting of an organization. Admins have the most permissions in your organization, and this role should be assigned with care.

  - __Dataset Manager:__ Manage all datasets of an organization. Dataset Managers have full read/write access to all datasets within their respective organizations regardless of whether a dataset has been made available only to a specific team. They can also set team permissions for datasets. Use this role for power users who regularly upload datasets or who need access to all datasets regardless of who created them.
  Unlike `Admins`, Dataset Managers do NOT have access to any of the administration interfaces for users, tasks, and projects.


Only *Admins* and *Team Managers* can see/access the `Admin` menu options in the navigation bar.

By default, each newly uploaded datasets can only be accessed by `Admins` and `Dataset Managers` without any restrictions. Make sure to add or remove one or more teams to a dataset for fine-grained access controls while/after uploading. Otherwise, regular `Members` or `Team Managers` might not be able to see a dataset in their dashboard, let alone create annotations for them. `Team Managers` can also upload datasets via the UI and assign teams during this step. 

For more information regarding (public) dataset sharing and access rights (especially with outside collaborators), [see the guide on sharing datasets](../sharing/dataset_sharing.md)


| Action                                           	| Admin 	| Dataset Manager 	| Team Manager 	| Team Member 	|
|--------------------------------------------------	|-------	|-----------------	|--------------	|-------------	|
| Access datasets of own teams                        	| Yes   	| Yes             	| Yes          	| Yes         	|
| Access datasets of other teams                      	| Yes   	| Yes             	| No           	| No          	|
| Edit datasets of own teams                       	| Yes   	| Yes             	| Yes          	| No          	|
| Edit datasets of other teams                     	| Yes   	| Yes             	| No           	| No          	|
| Access all users of own teams                       	| Yes   	| Yes             	| Yes          	| Yes         	|
| Access all users of other teams                     	| Yes   	| Yes             	| Yes          	| No          	|
| Assign/remove team membership to own teams       	| Yes   	| No              	| Yes          	| No          	|
| Make other users team manager of own teams   	| Yes   	| No              	| Yes          	| No          	|
| Make other users team manager of other teams   	| Yes   	| No              	| No           	| No          	|
| Grant *Dataset Manager* role to others        	| Yes   	| No              	| No           	| No          	|
| Grant *Admin* role to others                           	| Yes   	| No              	| No           	| No          	|
| Access time tracking for oneself                       	| Yes   	| Yes             	| Yes          	| Yes         	|
| Access time tracking for users of managed teams          	| Yes   	| No              	| Yes          	| No          	|
| Create scripts (visible to everyone)            	| Yes   	| No              	| Yes          	| No          	|
| Upload Datasets via UI                           	| Yes   	| Yes             	| Yes          	| No          	|
| Set team access permissions for datasets    	| Yes   	| Yes              	| Yes          	| No          	|
| Get tasks again after canceling an instance     	| Yes   	| No              	| Yes          	| No          	|
| Access to wK Statistics Menu  	| Yes   	| No              	| Yes          	| No          	|