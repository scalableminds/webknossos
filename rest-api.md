# webKnossos REST API

_Last updated 2018-10-18_

The following HTTP requests may be used to interact with the backend of webKnossos. Please keep the server load in mind and avoid sending excessive amounts of requests or huge individual ones.

## Authentication

All API routes expect the HTTP header `X-Auth-Token` to be set to your personal webKnossos token. You can find this token in the webKnossos menu, directly below “logout”.

## Routes


### `GET /api/buildinfo`

#### Returns
JSON object containing information about the version of webKnossos


---
### `GET /api/users`

List all users for which you have read access

#### Expects
 - Optional GET parameter `isEditable=[BOOLEAN]`
   - If true: list only users for which you can change team memberships
   - If false: list only users for which you can not change team memberships
 - Optional GET parameter `isAdmin=[BOOLEAN]`
   - If true: list only admins
   - If false: list only non-admins

#### Returns
 - JSON list of objects containing user information, including team memberships and experiences



---
### `GET /api/user`

#### Returns
 - JSON object containing user information about yourself, including team memberships and experiences


---
### `GET /api/user/tasks`

List your own task annotations

#### Expects
 - Optional GET parameter `isFinished=[BOOLEAN]`
   - if true: list only finished task annotations
   - if false: list only unfinished task annotations
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to 1000)

#### Returns
 - JSON list of objects containing annotation information about your own task annotations, also including task and task type information


---
### `GET /api/user/annotations`

List your own explorative annotations

#### Expects
 - Optional GET parameter `isFinished=[BOOLEAN]`
   - if true: list only finished (=archived) explorative annotations
   - if false: list only unfinished (=non-archived) explorative annotations
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to 1000)

#### Returns
 - JSON list of objects containing annotation information about your own explorative annotations




---
### `GET /api/users/:id`

#### Expects
 - In the url: `:id` id of a user

#### Returns
 - JSON object containing user information about the selected user, including team memberships and experiences


---
### `GET /api/users/:id/tasks`

List the task annotations of a user

#### Expects
 - In the url: `:id` id of a user
 - Optional GET parameter `isFinished=[BOOLEAN]`
   - if true: list only finished task annotations
   - if false: list only unfinished task annotations
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to 1000)

#### Returns
 - JSON list of objects containing annotation information about the task annotations of the user, also including task and task type information


---
### `GET /api/users/:id/annotations`

List the explorative annotations of a uaser

#### Expects
 - In the url: `:id` id of a user
 - Optional GET parameter `isFinished=[BOOLEAN]`
   - If true: list only finished (=archived) explorative annotations
   - If false: list only unfinished (=non-archived) explorative annotations
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to 1000)

#### Returns
 - JSON list of objects containing annotation information about the explorative annotations of the user



---
### `GET /api/teams`

List all teams that you can manage

#### Returns
 - JSON list of objects containing team information



---
### `GET /api/datasets`

List all datasets for which you have read access

#### Expects
 - Optional GET parameter `isEditable=[BOOLEAN]`
   - If true: list only datasets you can edit
   - If false: list only datasets you can not edit
 - Optional GET parameter `isActive=[BOOLEAN]`
   - If true: list only datasets that are active (=imported)
   - If false: list only datasets that are inactive (=non-imported)


#### Returns
 - JSON list of objects containing dataset information


---
### `GET /api/datasets/:organizationName/:dataSetName`

#### Expects
 - In the url: `:organizationName` the url-safe name of your organization, e.g. `Connectomics_Department`
 - In the url: `:dataSetName` the name of the dataset

#### Returns
 - JSON object containing dataset information



---
### `GET  /api/annotations/:typ/:id/info`

#### Expects
 - In the url: `:typ` – one of `Task`, `Explorational`, `CompoundTask`, `CompoundProject`, `CompoundTaskType`
 - In the url: `id`
   - for `Task` and `Explorational` annotations, `:id` is an annotation id
   - for `CompoundTask` `:id` is a task id
   - for `CompoundProject` `:id` is a project id
   - for `CompoundTaskType` `:id` is a task type id

#### Returns
 - JSON object containing annotation information about the selected annotation

#### Note

The compound annotations are created as merged from the finished annotations associated with the Task/Project/TaskType. This merging is performed before this info request is answered and can be slow for large numbers of annotations. The merged annotations are then stored in a cache for a few minutes, but not on disk. If requested again within this time, the request will be answered more quickly, but newly finished annotations will not be included yet. This cache is shared between this info request and the download request.


---
### `GET /api/annotations/:typ/:id/download`

Download an annotation as NML/ZIP

#### Expects
 - In the url: `:typ` and `:id` as described above under `GET /api/annotations/:typ/:id/info`

#### Returns
 - As chunked file stream:
   - In case of an explorative annotation with a volume tracing:
     - A ZIP file containing both an NML file and a data.zip file with the volume data
   - In case of a single explorative or task annotation with no volume tracing:
     - A single NML file
   - In case of compound downloads (CompoundTask/CompoundProject/CompoundTaskType):
     - A ZIP file containing individual NML files for all associated annotations

---
### `POST /api/annotations/upload`

Upload NML(s) or ZIP(s) of NML(s) to create a new explorative annotation

#### Expects
 - As file attachment: any number of NML files or ZIP files containing NMLs, optionally with at most one volume data ZIP referenced from an NML in a ZIP
 - As form parameter: `createGroupForEachFile` [String] should be one of `"true"` or `"false"`
   - If `"true"`: in merged annotation, create tree group wrapping the trees of each file
   - If `"false"`: in merged annotation, rename trees with the respective file name as prefix

#### Returns
 - JSON object containing annotation information about the newly created annotation, including the assigned id


---
### `POST /api/annotations/:typ/:id/duplicate`
Duplicate an annotation (“copy to my account”)

#### Expects
 - In the url: `:typ` and `:id` as described above under `GET  /api/annotations/:typ/:id/info`

#### Returns
 - JSON object containing annotation information about the newly created (duplicated) annotation, including the assigned id


---
### `PATCH /api/annotations/:typ/:id/edit`

Edit metadata of an annotation

#### Expects
 - In the url: `:typ` – one of `Task`, `Explorational`
 - In the url: `:id` an annotation id
 - JSON object with optional fields
   - `"name"` `[STRING]` new name for the annotation
   - `"description"` `[STRING]` new description for the annotation
   - `"isPublic"` `[BOOLEAN]` whether or not the tracing should be shared publicly
   - `"tags"` `[LIST[STRING]]` list of tags for the annotation

#### Returns
 - JSON object containing annotation information about the edited annotation


---
### `PATCH /api/annotations/:typ/:id/finish`

#### Expects
 - In the url: `:typ` – one of `Task`, `Explorational`
 - In the url: `:id` an annotation id

#### Returns
 - JSON object containing annotation information about the finished annotation


---
### `PATCH /api/annotations/:typ/:id/reopen`

#### Expects
 - In the url: `:typ` – one of `Task`, `Explorational`
 - In the url: `:id` an annotation id

#### Returns
 - JSON object containing annotation information about the reopened annotation


---
### `PUT /api/annotations/Task/:id/reset`

Reset a task annotation to its base state

#### Expects
 - In the url: `:id` an annotation id

#### Returns
 - JSON object containing annotation information about the reset task annotation


---
### `POST /api/annotations/:typ/:id/merge/:mergedTyp/:mergedId`

Merge two annotations, creating a new explorative.

#### Expects
 - In the url: `:typ` and `:id` as described above under `GET /api/annotations/:typ/:id/info`
 - In the url: `:mergedTyp` and `:mergedId` as described above under `GET /api/annotations/:typ/:id/info`




---
### `POST /api/tasks`

Create tasks without attached NML files

#### Expects
 - JSON list of objects. Each has these fields:
   - `"taskTypeId"` `[STRING]`
   - `"neededExperience"` `[JSON OBJECT]` with these fields:
     - `"domain"` `[STRING]`
     - `"value"` `[INT]`
   - `"openInstances"` `[INT]`
   - `"projectName"` `[STRING]`
   - `"scriptId"` (optional) `[STRING]`
   - `"boundingBox"` (optional) `[JSON OBJECT]` with these fields:
     - `"topLeft"` `[JSON LIST OF THREE INTS]`
     - `"width"` `[INT]`
     - `"height"` `[INT]`
     - `"depth"` `[INT]`
   - `"dataSet"` `[STRING]` name of the dataset
   - `"editPosition"` `[JSON LIST OF THREE INTS]` starting coordinates
   - `"editRotation"` `[JSON LIST OF THREE INTS]` starting rotation
   - `"creationInfo"` (optional) `[STRING]` identifier to match with task creation result report
   - `"description"` (optional) `[STRING]`


#### Returns

 - JSON list with status reports about the created tasks, including their ids

#### Note

For each attached NML file, one task is created. This request will also return status code 200 if some tasks could not be created. Failed tasks are instead encoded in the JSON response


---
### `POST /api/tasks/createFromFiles`

Create tasks with attached NML files

#### Expects
 - Form data field `"formJSON"`
   - JSON object with these fields:
     - `""`
     - `"taskTypeId"` `[STRING]`
     - `"neededExperience"` `[JSON OBJECT]` with these fields:
       - `"domain"` `[STRING]`
       - `"value"` `[INT]`
     - `"openInstances"` `[INT]`
     - `"projectName"` `[STRING]`
     - `"scriptId"` (optional) `[STRING]`
     - `"boundingBox"` (optional) `[JSON OBJECT]` with these fields:
       - `"topLeft"` `[JSON LIST OF THREE INTS]`
       - `"width"` `[INT]`
       - `"height"` `[INT]`
       - `"depth"` `[INT]`
  - Attached NML files

#### Returns

 - JSON list with status reports about the created tasks, including their ids

#### Note

For each attached NML file, one task is created. This request will also return status code 200 if some tasks could not be created. Failed tasks are instead encoded in the JSON response



## TODO

POST          /api/tasks/list
GET           /api/tasks/:id
DELETE        /api/tasks/:id
PUT           /api/tasks/:id
GET           /api/tasks/:id/annotations
GET           /api/tasks/:id/annotations

GET           /api/projects
GET           /api/projects/assignments
POST          /api/projects
GET           /api/projects/:name
DELETE        /api/projects/:name
PUT           /api/projects/:name
GET           /api/projects/:name/tasks
PATCH         /api/projects/:name/incrementEachTasksInstances
PATCH         /api/projects/:name/pause
PATCH         /api/projects/:name/resume
