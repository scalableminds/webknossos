const esc = require("pg-escape");
const mongodb = require("mongodb");
const fs = require("fs");

const DEFAULT_TEAM_OWNER = "5447d5902d00001c35e1c965";
const DEFAULT_PROJECT = "orphaned-tasks";

function formatVector3(vec) {
  return `(${vec[0]},${vec[1]},${vec[2]})`;
}
function formatBB(bb) {
  if (bb != null) {
    return `(${bb.topLeft[0]},${bb.topLeft[1]},${bb
      .topLeft[2]},${bb.width},${bb.height},${bb.depth})`;
  }
  return null;
}

function formatValue(value) {
  if (value == null) {
    return "";
  }
  if (Array.isArray(value)) {
    return esc.literal(`{${value.map(a => formatValue(a)).join(",")}}`);
  }
  if (value instanceof Date) {
    return esc.literal(value.toISOString());
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "t" : "f";
  }
  return esc.literal(value);
}

function* csvWriter(name, cols) {
  const f = fs.createWriteStream(`out/${name}.csv`, "utf8");
  f.write(cols.map(a => esc.ident(a)).join(","));
  f.write("\n");
  let obj = null;
  let i = 0;
  while ((obj = yield) != null) {
    // console.log(obj);
    f.write(cols.map(a => formatValue(obj[a])).join(","));
    f.write("\n");
    i++;
    if (i % 100000 === 0 && i > 0) console.error(name, i);
  }
  f.end();
  console.error(name, "done");
}

(async function() {
  const mongoClient = await mongodb.connect(process.env.MONGOURL || "mongodb://localhost:27017");
  const m = mongoClient.db(process.env.MONGODB || "webknossos-master");

  try {
    const buffer = { teams: new Map(), projects: new Map(), dataSets: new Map() };
    async function lookupTeam(team) {
      if (!buffer.teams.has(team)) {
        buffer.teams.set(team, await m.collection("teams").findOne({ name: team }));
      }
      return buffer.teams.get(team);
    }
    async function lookupProject(project) {
      if (!buffer.projects.has(project)) {
        buffer.projects.set(project, await m.collection("projects").findOne({ name: project }));
      }
      return buffer.projects.get(project);
    }
    async function lookupDataset(dataSet) {
      if (!buffer.dataSets.has(dataSet)) {
        buffer.dataSets.set(dataSet, await m.collection("dataSets").findOne({ name: dataSet}));
      }
      return buffer.dataSets.get(dataSet)
    }

    async function migrateTable(table, cols, func) {
      const csv = csvWriter(table, cols);
      csv.next();
      const cursor = m.collection(table).find({});
      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        // console.log(doc);
        const obj = await func(doc);
        if (obj != null) {
          csv.next(obj);
        }
      }
      csv.next();
    }

    {
      const dataSet_allowedTeams = csvWriter("dataSet_allowedTeams", ["_dataSet", "_team"]);
      dataSet_allowedTeams.next();
      const dataSet_layers = csvWriter("dataSet_layers", [
        "_dataSet",
        "name",
        "category",
        "resolutions",
        "elementClass",
        "boundingBox",
        "scale",
      ]);
      dataSet_layers.next();
      const cursor = m.collection("dataSets").find({});
      while (await cursor.hasNext()) {
        const doc = await cursor.next();

        for (const team of doc.allowedTeams) {
          dataSet_allowedTeams.next({
            _dataSet: doc._id.toHexString(),
            _team: (await lookupTeam(team))._id.toHexString(),
          });
        }

        if (doc.dataSource.dataLayers != null) {
          for (const doc_layer of doc.dataSource.dataLayers) {
            dataSet_layers.next({
              _dataSet: doc._id.toHexString(),
              name: doc_layer.name,
              category: doc_layer.category,
              resolutions: doc_layer.resolutions,
              elementClass: doc_layer.elementClass,
              boundingBox: formatBB(doc_layer.boundingBox),
              scale: formatVector3(doc.dataSource.scale),
            });
          }
        }
      }
      dataSet_allowedTeams.next();
      dataSet_layers.next();
    }

    await migrateTable("analytics", ["_id", "_user", "namespace", "value", "created", "isDeleted"], async doc => ({
      _id: doc._id,
      _user: doc.user != null ? doc.user.toHexString() : null,
      namespace: doc.namespace,
      value: JSON.stringify(doc.value),
      created: new Date(doc.timestamp),
      isDeleted: false
    }));

    await migrateTable(
      "dataSets",
      [
        "_id",
        "_dataStore",
        "_team",
        "defaultConfiguration",
        "description",
        "isPublic",
        "isUsable"
        "name",
        "created",
        "isDeleted",
      ],
      async doc => ({
        _id: doc._id.toHexString(),
        _dataStore: doc.dataStoreInfo.name,
        _team: (await lookupTeam(doc.dataSource.id.team))._id.toHexString(),
        defaultConfiguration: JSON.stringify(doc.defaultConfiguration),
        description: doc.description,
        isPublic: !!doc.isPublic,
        isUsable: doc.isActive,
        name: doc.dataSource.id.name,
        created: new Date(doc.created),
        isDeleted: false,
      }),
    );

    await migrateTable(
      "annotations",
      [
        "_id",
        "_task",
        "_team",
        "_user",
        "tracing_id",
        "tracing_typ",
        "description",
        "isPublic",
        "name",
        "state",
        "statistics",
        "tags",
        "tracingTime",
        "typ",
        "created",
        "modified",
        "isDeleted",
      ],
      async doc => ({
        _id: doc._id.toHexString(),
        _dataSet: doc.dataSetName != null ? (await lookupDatsaet(doc.dataSetName))._id.toHexString() : null
        _task: doc._task != null ? doc._task.toHexString() : null,
        _team: doc.team != null ? (await lookupTeam(doc.team))._id.toHexString() : null,
        _user: doc._user.toHexString(),
        tracing_id: doc.tracingReference.id,
        tracing_typ: doc.tracingReference.typ,
        description: doc.description,
        isPublic: !!doc.isPublic,
        name: doc._name != null ? doc._name : "",
        state: doc.state,
        statistics: doc.statistics != null ? JSON.stringify(doc.statistics) : "{}",
        tags: doc.tags,
        tracingTime: doc.tracingTime,
        typ: doc.typ == "Tracing Base" ? "TracingBase" : doc.typ,
        created: new Date(doc.createdTimestamp),
        modified: new Date(doc.modifiedTimestamp),
        isDeleted: !doc.isActive,
      }),
    );

    await migrateTable("dataStores", ["name", "url", "key", "typ", "isDeleted"], async doc => ({
      name: doc.name,
      url: doc.url,
      key: doc.key,
      typ: doc.typ,
      isDeleted: false
    }));

    await migrateTable(
      "projects",
      ["_id", "_team", "_owner", "name", "priority", "paused", "expectedTime", "created"],
      async doc => ({
        _id: doc._id.toHexString(),
        _team: doc.team != null ? (await lookupTeam(doc.team))._id.toHexString() : null,
        _owner: doc._owner.toHexString(),
        name: doc.name,
        priority: doc.priority,
        paused: doc.paused,
        expectedTime: doc.expectedTime != null ? `${doc.expectedTime} milliseconds}` : null,
        created: doc._id.getTimestamp(),
        isDeleted: false
      }),
    );

    await migrateTable("scripts", ["_id", "_owner", "name", "gist", "created"], async doc => ({
      _id: doc._id.toHexString(),
      _owner: doc._owner,
      name: doc.name,
      gist: doc.gist,
      created: doc._id.getTimestamp(),
    }));

    // Need to delete {"summary":"synapse_to_axon", "isActive":false}
    await migrateTable(
      "taskTypes",
      [
        "_id",
        "_team",
        "summary",
        "description",
        "settings_allowedModes",
        "settings_preferredMode",
        "settings_branchPointsAllowed",
        "settings_somaClickingAllowed",
        "created",
        "isDeleted",
      ],
      async doc => ({
        _id: doc._id.toHexString(),
        _team: doc.team != null ? (await lookupTeam(doc.team))._id.toHexString() : null,
        summary: doc.summary,
        description: doc.description,
        settings_allowedModes: `{${doc.settings.allowedModes.join(",")}}`,
        settings_preferredMode: doc.settings.preferredMode,
        settings_branchPointsAllowed: doc.settings.branchPointsAllowed,
        settings_somaClickingAllowed: doc.settings.somaClickingAllowed,
        created: doc._id.getTimestamp(),
        isDeleted: !doc.isActive,
      }),
    );

    await migrateTable(
      "teams",
      ["_id", "_owner", "_parent", "name", "behavesLikeRootTeam", "created"],
      async doc => ({
        _id: doc._id.toHexString(),
        _owner: doc.owner != null ? doc.owner.toHexString() : DEFAULT_TEAM_OWNER,
        _parent: doc.parent != null ? (await lookupTeam(doc.parent))._id.toHexString() : null,
        name: doc.name,
        behavesLikeRootTeam: !!doc.behavesLikeRootTeam,
        created: doc._id.getTimestamp(),
        isDeleted: false,
      }),
    );

    await migrateTable(
      "timeSpans",
      ["_id", "_user", "_annotation", "time", "timestamp", "lastUpdate", "numberOfUpdates"],
      async doc => ({
        _id: doc._id.toHexString(),
        _user: doc._user.toHexString(),
        _annotation: mongodb.ObjectID.isValid(doc.annotation) ? doc.annotation : null,
        time: `${doc.time} milliseconds`,
        timestamp: new Date(doc.timestamp),
        lastUpdate: new Date(doc.lastUpdate),
        numberOfUpdates: doc.numberOfUpdates != null ? doc.numberOfUpdates : 1,
      }),
    );

    // Need to delete {"_project":"Oxalis Training"}
    // Recreate project {"name":"DalilaTest"}
    await migrateTable(
      "tasks",
      [
        "_id",
        "_project",
        "_script",
        "_taskType",
        "_team",
        "neededExperience_domain",
        "neededExperience_value",
        "totalInstances",
        "tracingTime",
        "boundingBox",
        "editPosition",
        "editRotation",
        "creationInfo",
        "created",
        "isDeleted",
      ],
      async doc => {
        let project = await lookupProject(doc._project);
        if (project == null) {
          let project = await lookupProject(DEFAULT_PROJECT);
          return null;
        }
        return {
          _id: doc._id.toHexString(),
          _project: project._id.toHexString(),
          _script: doc._script != "" ? doc._script : null,
          _team: (await lookupTeam(doc.team))._id.toHexString(),
          _taskType: doc._taskType.toHexString(),
          neededExperience_domain: doc.neededExperience.domain,
          neededExperience_value: doc.neededExperience.value,
          totalInstances: doc.instances,
          tracingTime: doc.tracingTime != null ? `${doc.tracingTime} milliseconds` : null,
          boundingBox: formatBB(doc.boundingBox),
          editPosition: formatVector3(doc.editPosition),
          editRotation: formatVector3(doc.editRotation),
          creationInfo: doc.creationInfo,
          created: doc._id.getTimestamp(),
          isDeleted: !doc.isActive,
        };
      },
    );

    await migrateTable(
      "users",
      [
        "_id",
        "email",
        "firstName",
        "lastName",
        "lastActivity",
        "userConfiguration",
        "dataSetConfigurations",
        "loginInfo_providerID",
        "loginInfo_providerKey",
        "passwordInfo_hasher",
        "passwordInfo_password",
        "isDeactivated",
        "isDeleted",
        "isSuperUser",
        "created",
      ],
      async doc =>
        doc.email != null
          ? {
              _id: doc._id.toHexString(),
              email: doc.email,
              firstName: doc.firstName,
              lastName: doc.lastName,
              lastActivity: new Date(doc.lastActivity || 0),
              userConfiguration: JSON.stringify(doc.userConfiguration),
              dataSetConfigurations: JSON.stringify(doc.dataSetConfigurations),
              loginInfo_providerID: doc.loginInfo.providerID,
              loginInfo_providerKey: doc.loginInfo.providerKey,
              passwordInfo_hasher: "scrypt",
              passwordInfo_password: doc.passwordInfo.password,
              isDeactivated: !doc.isActive,
              isDeleted: false,
              isSuperUser: !!doc._isSuperUser,
              created: doc._id.getTimestamp(),
            }
          : null,
    );

    // Need to fix teams of {"email":"mike@mhlab.net"}
    {
      const user_team_roles = csvWriter("user_team_roles", ["_user", "_team", "role"]);
      user_team_roles.next();
      const user_experiences = csvWriter("user_experiences", ["_user", "domain", "value"]);
      user_experiences.next();
      const cursor = m.collection("users").find({});
      while (await cursor.hasNext()) {
        const doc = await cursor.next();

        if (doc.teams != null) {
          for (const { team, role } of doc.teams) {
            user_team_roles.next({
              _user: doc._id.toHexString(),
              _team: (await lookupTeam(team))._id.toHexString(),
              role: role.name,
            });
          }
        }

        if (doc.experiences != null) {
          for (const [domain, value] of Object.entries(doc.experiences)) {
            user_experiences.next({
              _user: doc._id.toHexString(),
              domain,
              value,
            });
          }
        }
      }
      user_team_roles.next();
      user_experiences.next();
    }
  } catch (err) {
    console.error(err);
  } finally {
    mongoClient.close();
  }
})();
