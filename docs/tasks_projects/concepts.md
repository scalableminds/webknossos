# Concepts

- `Task`: Is an assignment for a small piece of work. A _Team Manager_ or _Admin_ creates _Tasks_ with information about the _Task Type_, the referenced dataset, starting positions, and advanced options. These tasks will be distributed to eligible users.
- `Task Instance`: Some _Tasks_ need to be completed redundantly by multiple users to assure quality. The single assignments of the tasks are called Instances.
- `Task Type`: Contains a blueprint for _Tasks_. Includes metadata, such as a description with instructions, allowed annotation modes, and advanced options.
- `Project`: A group of many related Tasks is called a _Project_. Projects have a priority assigned to them which affects the order of assignment to users. Projects may be paused and resumed to manage the user workloads and priorities.
- `Experience`: _Admins_ and _Team Managers_ can assign experience levels to users. _Experiences_ are defined by a domain and a value, such as `flight-annotation` and `100`. Tasks specify the required experience level of a user.

It is possible to download all annotations that belong to either a _Project_ or a _Task Type_ for further processing.

![youtube-video](https://www.youtube.com/embed/YC4vaia6MkY)