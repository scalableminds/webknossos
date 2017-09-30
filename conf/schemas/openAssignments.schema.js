db.runCommand({
  collMod: "openAssignments",
  validator: {
    $and: [
      {
        instances: { $type: "number", $exists: true },
      },
      {
        _task: { $type: "objectId", $exists: true },
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        _project: { $type: "string", $exists: true },
      },
      {
        neededExperience: { $type: "object", $exists: true },
      },
      {
        "neededExperience.domain": { $regex: "^.{3,}$", $exists: true },  //empty domains
      },                                                                         
      {                                                                           
        "neededExperience.value": { $type: "number", $exists: true },
      },
      {
        priority: { $type: "number", $exists: true },
      },
      {
        created: { $type: "number", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
//single instance no errors