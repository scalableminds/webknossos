# webKnossos REST API

The following HTTP requests may be used to interact with the backend of webKnossos. Please keep the server load in mind and avoid sending excessive amounts of requests or huge individual ones.

## Authentication

All API routes expect the HTTP header `X-Auth-Token` to be set to your personal webKnossos token. You can find this token in the webKnossos menu, directly above “logout”.

## Versioning

The API is subject to frequent changes. However, older versions will be supported for some time via prefixed routes.
 - To access the latest version, call the routes below with only the `/api` prefix.
 - To access a specific version, call the routes below with a prefix in the form of `/api/v1`.

New versions will be documented here, detailing the changes. Note, however, that some changes are not considered to be breaking the API and will not lead to new versions. Such changes include new optional parameters as well as new fields in the responses. The same goes for error message wording.

### Current api version is `v5`

* New in v5:
  - The annotation json no longer contains `skeletonTracingId` and `volumeTracingId`, but instead a list of `annotationLayers`, each containing of `tracingId: String, typ: AnnotationLayerType, name: Option[String]`.
  - `createExplorational` now expects list of layer parameters (`typ: AnnotationLayerType, fallbackLayerName: Option[String], resolutionRestrictions: Option[ResolutionRestrictions], name: Option[String]`)

* New in v4: /projects routes no longer expect `name` but now `id`. The same goes for `POST /tasks/list` when filtering by project.

* New in v3: the info and finish requests of annotations now expect an additional `timestamp` GET parameter that should be set to the time the request is sent (e.g. Date.now()).

* New in v2: in comparison to `v1` the annotation `isPublic` flag was replaced by a `visibility` field. This field can have the following values: `Public, Internal, Private`.


## Routes

### `GET /buildinfo`

#### Returns
JSON object containing information about the version of webKnossos


---
### `GET /users`

List all users for which you have read access

#### Expects
 - Optional GET parameter `isEditable=[BOOLEAN]`
   - If true: list only users for which you can change team memberships
   - If false: list only users for which you cannot change team memberships
 - Optional GET parameter `isAdmin=[BOOLEAN]`
   - If true: list only admins
   - If false: list only non-admins

#### Returns
 - JSON list of objects containing user information, including team memberships and experiences



---
### `GET /user`

#### Returns
 - JSON object containing user information about yourself, including team memberships and experiences


---
### `GET /user/tasks`

List your own task annotations

#### Expects
 - Optional GET parameter `isFinished=[BOOLEAN]`
   - if true: list only finished task annotations
   - if false: list only unfinished task annotations
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to 1000)
 - Optional GET parameter `pageNumber=[INT]`
   - return the results starting at offset `limit` * `pageNumber` (defaults to 0)
 - Optional GET parameter `includeTotalCount=[BOOLEAN]`
    - if true returns the total count of entries (defaults to false)

#### Returns
 - JSON list of objects containing annotation information about your own task annotations, also including task and task type information
 - total count of task annotations in the HTTP header `X-Total-Count` if parameter is set

#### Changes Introduced in `v2`
 - The annotation objects in the returned JSON contain the `visibility` field instead of the old `isPublic` field

---
### `GET /user/annotations`

List your own explorative annotations

#### Expects
 - Optional GET parameter `isFinished=[BOOLEAN]`
   - if true: list only finished (=archived) explorative annotations
   - if false: list only unfinished (=non-archived) explorative annotations
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to 1000)
 - Optional GET parameter `pageNumber=[INT]`
   - return the results starting at offset `limit` * `pageNumber` (defaults to 0)
 - Optional GET parameter `includeTotalCount=[BOOLEAN]`
     - if true returns the total count of entries (defaults to false)

#### Returns
 - JSON list of objects containing annotation information about your own explorative annotations
 - total count of explorative annotations in the HTTP header `X-Total-Count` if parameter is set

#### Changes Introduced in `v2`
 - The annotation objects in the returned JSON contain the `visibility` field instead of the old `isPublic` field



---
### `GET /users/:id`

#### Expects
 - In the url: `:id` id of a user

#### Returns
 - JSON object containing user information about the selected user, including team memberships and experiences


---
### `GET /users/:id/tasks`

List the task annotations of a user

#### Expects
 - In the url: `:id` id of a user
 - Optional GET parameter `isFinished=[BOOLEAN]`
   - if true: list only finished task annotations
   - if false: list only unfinished task annotations
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to 1000)
 - Optional GET parameter `pageNumber=[INT]`
   - return the results starting at offset `limit` * `pageNumber` (defaults to 0)
 - Optional GET parameter `includeTotalCount=[BOOLEAN]`
     - if true returns the total count of entries (defaults to false)

#### Returns
 - JSON list of objects containing annotation information about the task annotations of the user, also including task and task type information
 - total count of task annotations in the HTTP header `X-Total-Count` if parameter is set
 - total count of task annotations in the HTTP header `X-Total-Count` if parameter is set


#### Changes Introduced in `v2`
 - The annotation objects in the returned JSON contain the `visibility` field instead of the old `isPublic` field

---
### `GET /users/:id/annotations`

List the explorative annotations of a user

#### Expects
 - In the url: `:id` id of a user
 - Optional GET parameter `isFinished=[BOOLEAN]`
   - If true: list only finished (=archived) explorative annotations
   - If false: list only unfinished (=non-archived) explorative annotations
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to 1000)
 - Optional GET parameter `pageNumber=[INT]`
   - return the results starting at offset `limit` * `pageNumber` (defaults to 0)
 - Optional GET parameter `includeTotalCount=[BOOLEAN]`
     - if true returns the total count of entries (defaults to false)

#### Returns
 - JSON list of objects containing annotation information about the explorative annotations of the user
 - total count of explorative annotations in the HTTP header `X-Total-Count` if parameter is set

#### Changes Introduced in `v2`
 - The annotation objects in the returned JSON contain the `visibility` field instead of the old `isPublic` field


---
### `GET /teams`

List all teams that you can manage

#### Returns
 - JSON list of objects containing team information



---
### `GET /datasets`

List all datasets for which you have read access

#### Expects
 - Optional GET parameter `isEditable=[BOOLEAN]`
   - If true: list only datasets you can edit
   - If false: list only datasets you cannot edit
 - Optional GET parameter `isActive=[BOOLEAN]`
   - If true: list only datasets that are active (=imported)
   - If false: list only datasets that are inactive (=non-imported)


#### Returns
 - JSON list of objects containing dataset information

#### Note

The list of resolutions for each data layer is always empty in this list, for performance reasons.
To get the actual resolutions, please use `GET /datasets/:organizationName/:dataSetName` (see below).

---
### `GET /datasets/:organizationName/:dataSetName`

#### Expects
 - In the url: `:organizationName` the url-safe name of your organization, e.g. `sample_organization` or `edbdcad7d2033380`
 - In the url: `:dataSetName` the name of the dataset

#### Returns
 - JSON object containing dataset information

---
### `POST /datasets/:organizationName/:dataSetName/createExplorational`

#### Expects
 - In the url: `:organizationName` the url-safe name of your organization, e.g. `sample_organization` or `edbdcad7d2033380`
 - In the url: `:dataSetName` the name of the dataset
 - In the JSON body: A list of layer parameter objects (`typ: AnnotationLayerType, fallbackLayerName: Option[String], resolutionRestrictions: Option[ResolutionRestrictions], name: Option[String]`) where the type `ResolutionRestrictions` is an object with `min: Option[Int], max: Option[Int]` and AnnotationLayerType is a string with possible values `Skeleton`, `Volume`.

#### Returns
 - JSON object containing annotation information about the newly created annotation, including the assigned id

#### Changes Introduced in `v5`
 - Now expects a List of layer parameters, rather than the old format (a single object containing `typ: String, fallbackLayerName: Option[String], resolutionRestrictions: Option[ResolutionRestrictions]`)


---
### `GET /datastores`

Lists all available datastores

#### Returns
 - JSON list of objects containing datastore information

---
### `POST /datastores`

Create a new datastore

#### Expects
 - JSON object
    - `"name"` `[STRING]` name of the datastore
    - `"url"` `[STRING]` url from the datastore, used for communication with wk
    - `"publicUrl"` `[STRING]` publicly accessible url from the datastore, used for user facing links
    - `"key"` `[STRING]` key used to identify the datastore
    - `"isScratch"` `[BOOLEAN]` (optional, default: `false`) whether or not the datastore is hosted on a scratch/experimental environment
    - `"isForeign"` `[BOOLEAN]` (optional, default: `false`) whether or not the datastore belongs to this wk instance or belongs to a foreign wk instance
    - `"isConnector"` `[BOOLEAN]` (optional, default: `false`) whether or not the datastore is a wk-connect instance
    - `"allowsUpload"` `[BOOLEAN]` (optional, default: `true`) whether or not the datastore supports dataset upload via browser


#### Returns
 - JSON object containing information about the newly created datastore

#### Note
 - This route is only accessible for administrators.

---
### `DELETE /datastores/:name`

Deletes a datastore from the wk database

#### Expects
 - In the url: `:name` - the name of the datastore which should be deleted

#### Note
 - This route is only accessible for administrators.

---
### `PUT /datastores/:name`

Update an existing datastore

#### Expects
 - In the url: `:name` - the name of the datastore which should be deleted
 - JSON object
    - `"name"` `[STRING]` name of the datastore
    - `"url"` `[STRING]` url from the datastore, used for communication with wk
    - `"publicUrl"` `[STRING]` publicly accessible url from the datastore, used for user facing links
    - `"isScratch"` `[BOOLEAN]` (optional, default: `false`) whether or not the datastore is hosted on a scratch/experimental environment
    - `"isForeign"` `[BOOLEAN]` (optional, default: `false`) whether or not the datastore belongs to this wk instance or belongs to a foreign wk instance
    - `"isConnector"` `[BOOLEAN]` (optional, default: `false`) whether or not the datastore is a wk-connect instance
    - `"allowsUpload"` `[BOOLEAN]` (optional, default: `true`) whether or not the datastore supports dataset upload via browser


#### Returns
 - JSON object containing information about the updated datastore

#### Note
 - This route is only accessible for administrators.

---
### `PUT /tracingstores/:name`

Update an existing tracingstore

#### Expects
 - In the url: `:name` - the name of the tracingstore which should be deleted
 - JSON object
    - `"name"` `[STRING]` name of the tracingstore
    - `"url"` `[STRING]` url from the tracingstore, used for communication with wk
    - `"publicUrl"` `[STRING]` publicly accessible url from the tracingstore, used for user facing links

#### Returns
 - JSON object containing information about the updated tracingstore

#### Note
 - This route is only accessible for administrators.

---
### `GET  /annotations/:typ/:id/info`

#### Expects
 - In the url: `:typ` – one of `Task`, `Explorational`, `CompoundTask`, `CompoundProject`, `CompoundTaskType`
 - In the url: `id`
   - for `Task` and `Explorational` annotations, `:id` is an annotation id
   - for `CompoundTask` `:id` is a task id
   - for `CompoundProject` `:id` is a project id
   - for `CompoundTaskType` `:id` is a task type id
 - GET parameter `timestamp=[INT]` timestamp in milliseconds (time the request is sent)

#### Returns
 - JSON object containing annotation information about the selected annotation

#### Note

The compound annotations are created as merged from the finished annotations associated with the Task/Project/TaskType. This merging is performed before this info request is answered and can be slow for large numbers of annotations. The merged annotations are then stored in a cache for a few minutes, but not on disk. If requested again within this time, the request will be answered more quickly, but newly finished annotations will not be included yet. This cache is shared between this info request and the download request.

#### Changes Introduced in `v3`
 - Expects additional GET parameter `timestamp=[INT]` timestamp in milliseconds (time the request is sent)

#### Changes Introduced in `v2`
 - The returned JSON contains the `visibility` field instead of the `isPublic` flag

---
### `GET /annotations/:typ/:id/download`

Download an annotation as NML/ZIP

#### Expects
 - In the url: `:typ` and `:id` as described above under `GET /annotations/:typ/:id/info`

#### Returns
 - As chunked file stream:
   - In case of a volume annotation:
     - A ZIP file containing both an NML file and a data.zip file with the volume data
   - In case of a single explorative or task annotation with no volume annotation:
     - A single NML file
   - In case of compound downloads (CompoundTask/CompoundProject/CompoundTaskType):
     - A ZIP file containing individual NML files for all associated annotations

---
### `POST /annotations/upload`

Upload NML(s) or ZIP(s) of NML(s) to create a new explorative annotation

#### Expects
 - As file attachment: any number of NML files or ZIP files containing NMLs, optionally with at most one volume data ZIP referenced from an NML in a ZIP
 - As form parameter: `createGroupForEachFile` [String] should be one of `"true"` or `"false"`
   - If `"true"`: in merged annotation, create tree group wrapping the trees of each file
   - If `"false"`: in merged annotation, rename trees with the respective file name as prefix

#### Returns
 - JSON object containing annotation information about the newly created annotation, including the assigned id


---
### `POST /annotations/:typ/:id/duplicate`
Duplicate an annotation (“copy to my account”)

#### Expects
 - In the url: `:typ` and `:id` as described above under `GET  /annotations/:typ/:id/info`

#### Returns
 - JSON object containing annotation information about the newly created (duplicated) annotation, including the assigned id

#### Changes Introduced in `v2`
 - The returned JSON contains the `visibility` field instead of the `isPublic` flag


---
### `PATCH /annotations/:typ/:id/edit`

Edit metadata of an annotation

#### Expects
 - In the url: `:typ` – one of `Task`, `Explorational`
 - In the url: `:id` an annotation id
 - JSON object with optional fields
   - `"name"` `[STRING]` new name for the annotation
   - `"description"` `[STRING]` new description for the annotation
   - `"visibility"` `["Public" | "Internal" | "Private"]` new visibility for the annotation
   - `"tags"` `[JSON LIST OF STRINGS]` list of tags for the annotation

#### Returns
 - JSON object containing annotation information about the edited annotation

#### Changes Introduced in `v2`
 - The request and returned JSON contain the `isPublic` `[BOOLEAN]` flag instead of the `visibility` field

---
### `PATCH /annotations/:typ/:id/finish`

#### Expects
 - In the url: `:typ` – one of `Task`, `Explorational`
 - In the url: `:id` an annotation id
 - GET parameter `timestamp=[INT]` timestamp in milliseconds (time the request is sent)

#### Returns
 - JSON object containing annotation information about the finished annotation

#### Changes Introduced in `v3`
 - Expects additional GET parameter `timestamp=[INT]` timestamp in milliseconds (time the request is sent)

#### Changes Introduced in `v2`
 - The returned JSON contains the `visibility` field instead of the `isPublic` flag


---
### `PATCH /annotations/:typ/:id/reopen`

#### Expects
 - In the url: `:typ` – one of `Task`, `Explorational`
 - In the url: `:id` an annotation id

#### Returns
 - JSON object containing annotation information about the reopened annotation

#### Changes Introduced in `v2`
 - The returned JSON contains the `visibility` field instead of the `isPublic` flag

---
### `PUT /annotations/Task/:id/reset`

Reset a task annotation to its base state

#### Expects
 - In the url: `:id` an annotation id

#### Returns
 - JSON object containing annotation information about the reset task annotation

#### Changes Introduced in `v2`
 - The returned JSON contains the `visibility` field instead of the `isPublic` flag

---
### `POST /annotations/:typ/:id/merge/:mergedTyp/:mergedId`

Merge two annotations, creating a new explorative.

#### Expects
 - In the url: `:typ` and `:id` as described above under `GET /annotations/:typ/:id/info`
 - In the url: `:mergedTyp` and `:mergedId` as described above under `GET /annotations/:typ/:id/info`

#### Returns
 - JSON object containing annotation information about the merged annotation

#### Changes Introduced in `v2`
 - The returned JSON contains the `visibility` field instead of the `isPublic` flag

---
### `POST /tasks`

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

This request will also return status code 200 if some tasks could not be created. Failed tasks are instead encoded in the JSON response.


---
### `POST /tasks/createFromFiles`

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




---
### `POST /tasks/list`

List tasks matching search criteria

#### Expects
 - JSON object with four optional fields:
   - `"user"` `[STRING]` show only tasks on which the user with this id has worked
   - `"project"` `[STRING]` show only tasks of the project with this id
   - `"ids"` `[JSON LIST OF STRINGS]` show only tasks with these ids
   - `"tasktype"` `[STRING]` show only tasks matching the task type with this id
   - `"random"` `[BOOLEAN]` if true, return randomized subset of the results, rather than the first 1000 matches in the database

#### Returns
 - JSON list of objects containing task information
 - Note that a maximum of 1000 results is returned

#### Changes Introduced in `v4`
 - The `"project"` field in the JSON object is no longer its name but instead its id.


---
### `GET /tasks/:id`

#### Expects
 - In the url: `:id` id of a task

#### Returns
 - JSON object containing task information



---
### `DELETE /tasks/:id`

Delete one task and all its annotations

#### Expects
 - In the url: `:id` id of a task



---
### `PUT /tasks/:id`

Update the number of open instances for a task

#### Expects
 - In the url: `:id` id of a task
 - JSON object like the ones in the list in `POST /tasks` (only `"openInstances"` is changed, though)

#### Returns
 - JSON object containing task information on the updated task



---
### `GET /tasks/:id/annotations`

List annotations of a task

#### Expects
 - In the url: `:id` a task id

#### Returns
 - JSON list of objects containing annotation information on the annotations of the task
 - Cancelled annotations are not returned

#### Changes Introduced in `v2`
 - The annotation objects in the returned JSON contain the `visibility` flag instead of the `isPublic` field

---
### `GET /projects`

List all projects for which you have read access

#### Returns

JSON list of objects containing project information



---
### `GET /projects/assignments`

List all projects for which you have read access, annotated with the number of open task instances

#### Returns

JSON list of objects containing project information, with additional field `numberOfOpenAssignments`




---
### `POST /projects`

Create a new project

#### Expects
 - JSON object with the following fields:
   - `"name"` `[STRING]`
   - `"team"` `[STRING]` id of a team
   - `"priority"` `[INT]`
   - `"paused"` `[BOOLEAN]`
   - `"expectedTime"` `[INT]` time limit
   - `"owner"` `[STRING]` id of a user
   - `"isBlacklistedFromReport"` `[BOOLEAN]`

#### Returns

JSON object containing project information about the newly created project, including the assigned id



---
### `GET /projects/:id`

#### Expects
 - In the url: `:id` id of a project

#### Returns
 - JSON object containing project information about the selected project

#### Changes Introduced in `v4`
 - The request no longer expects `name` in the url, but instead `id`


---
### `DELETE /projects/:id`

Delete a project and all its tasks and annotations

#### Expects
 - In the url: `:id` id of a project

#### Changes Introduced in `v4`
 - The request no longer expects `name` in the url, but instead `id`



---
### `PUT /projects/:id`

Update a project

#### Expects
 - JSON object just like in `POST /projects`

#### Returns
 - JSON object containing project information about the updated project

#### Changes Introduced in `v4`
 - The request no longer expects `name` in the url, but instead `id`



---
### `GET /projects/:id/tasks`

List all tasks of a project

#### Expects
 - In the url: `:id` id of a project
 - Optional GET parameter `limit=[INT]`
   - return only the first x results (defaults to infinity)
 - Optional GET parameter `pageNumber=[INT]`
   - return the results starting at offset `limit` * `pageNumber` (defaults to 0)
 - Optional GET parameter `includeTotalCount=[BOOLEAN]`
     - if true returns the total count of entries (defaults to false)

#### Returns
 - JSON list of objects containing task information
 - total count of tasks in the HTTP header `X-Total-Count` if parameter is set

#### Note
 - For smoother backwards compatibility, the limit defaults to infinity. However, to ease server load and improve response time, we suggest using a limit of 1000

#### Changes Introduced in `v4`
 - The request no longer expects `name` in the url, but instead `id`


---
### `PATCH /projects/:id/incrementEachTasksInstances`

Increment the open instances for each task of a project.

#### Expects
 - In the url: `id` `[STRING]` id of a project
 - Optional GET parameter `delta=[INT]` number of additional instances for each task (defaults to 1)

#### Returns
 - JSON object containing project information about the updated project, with additional field `numberOfOpenAssignments`

#### Changes Introduced in `v4`
 - The request no longer expects `name` in the url, but instead `id`



---
### `PATCH /projects/:id/pause`

Pause a project (no tasks will be assigned until resumed)

#### Expects
 - In the url: `:id` `[STRING]` id of a project

#### Returns
 - JSON object containing project information about the updated project

#### Changes Introduced in `v4`
 - The request no longer expects `name` in the url, but instead `id`


---
### `PATCH /projects/:id/resume`

Resume a paused project

#### Expects
 - In the url: `:id` `[STRING]` id of a project

#### Returns
 - JSON object containing project information about the updated project

#### Changes Introduced in `v4`
 - The request no longer expects `name` in the url, but instead `id`
