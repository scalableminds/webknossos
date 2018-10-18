# webKnossos REST API

Last updated 2018-10-18

The following HTTP requests may be used to interact with the backend of webKnossos. Please keep the server load in mind and avoid sending excessive amounts of requests or huge individual ones.

## Authentication

All API routes expect the HTTP header `X-Auth-Token` to be set to your personal webKnossos token. You can find this token in the webKnossos menu, directly below “logout”.

## Routes



### `GET /api/buildinfo`

#### returns

JSON object containing information about the version of webKnossos



### `GET /api/users`

Lists all users for which you have read access

#### expects

Optional GET parameter `isEditable=[BOOLEAN]`
 → If true: list only users for which you can change team memberships
 → If false: list only users for which you can not change team memberships

Optional GET parameter `isAdmin=[BOOLEAN]`
 → If true: list only admins
 → If false: list only non-admins

#### returns

JSON list of objects containing user information, including team memberships and experiences




### `GET /api/user`

#### returns

JSON object containing user information about yourself, including team memberships and experiences



### `GET /api/user/tasks`

List your own task annotations

#### expects

Optional GET parameter `isFinished=[BOOLEAN]`
 → if true: list only finished task annotations
 → if true: list only unfinished task annotations

Optional GET parameter `limit=[INT]`
 → return only the first x results (defaults to 1000)

#### returns

JSON list of objects containing annotation information about your own task annotations, also including task and task type information



### `GET /api/user/annotations`

List your own explorative annotations

#### expects

Optional GET parameter `isFinished=[BOOLEAN]`
 → if true: list only finished (=archived) explorative annotations
 → if true: list only unfinished (=non-archived) explorative annotations

Optional GET parameter `limit=[INT]`
 → return only the first x results (defaults to 1000)

#### returns

JSON list of objects containing annotation information about your own explorative annotations





### `GET /api/users/:id`

#### expects

In the url: `:id` id of a user

#### returns

JSON object containing user information about the selected user, including team memberships and experiences



### `GET /api/users/:id/tasks`

List the task annotations of a user

#### expects

In the url: `:id` id of a user

Optional GET parameter `isFinished=[BOOLEAN]`
 → if true: list only finished task annotations
 → if true: list only unfinished task annotations

Optional GET parameter `limit=[INT]`
 → return only the first x results (defaults to 1000)

#### returns

JSON list of objects containing annotation information about the task annotations of the user, also including task and task type information



### `GET /api/users/:id/annotations`

List the explorative annotations of a uaser

#### expects

In the url: `:id` id of a user

Optional GET parameter `isFinished=[BOOLEAN]`
 → if true: list only finished (=archived) explorative annotations
 → if true: list only unfinished (=non-archived) explorative annotations

Optional GET parameter `limit=[INT]`
 → return only the first x results (defaults to 1000)

#### returns

JSON list of objects containing annotation information about the explorative annotations of the user




### `GET /api/teams`

List all teams that you can manage

#### returns

JSON list of objects containing team information




### `GET /api/datasets`

List all datasets for which you have read access

#### expects

Optional GET parameter `isEditable=[BOOLEAN]`
 → if true: list only datasets you can edit
 → if true: list only datasets you can not edit

Optional GET parameter `isActive=[BOOLEAN]`
 → if true: list only datasets that are active (=imported)
 → if true: list only datasets that are inactive (=non-imported)


#### returns

JSON list of objects containing dataset information



### `GET /api/datasets/:organizationName/:dataSetName`

#### expects

In the url: `:organizationName` the url-safe name of your organization, e.g. `Connectomics_Department`
In the url: `:dataSetName` the name of the dataset

#### returns

JSON object containing dataset information




### `POST /api/annotations/upload`

Upload NML(s) or ZIP(s) of NML(s) to create a new explorative annotation

#### expects

As file attachment: any number of NML files or ZIP files containing NMLs, optionally with at most one volume data ZIP referenced from an NML in a ZIP

As form parameter: `createGroupForEachFile` [String] should be one of `"true"` or `"false"`
 → If `"true"`: in merged annotation, create tree group wrapping the trees of each file
 → If `"false"`: in merged annotation, rename trees with the respective file name as prefix

#### returns

JSON object containing annotation information about the newly created annotation, including the assigned id
