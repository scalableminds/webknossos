// Drop support for mouse inversion configuration

// --- !Ups
db.getCollection("users").update(
  {},
  {
    $unset: {
      "userConfiguration.configuration.inverseX": "",
      "userConfiguration.configuration.inverseY": "",
    },
  },
  { multi: true }
);

// --- !Downs
db.getCollection("users").update(
  {},
  {
    $set: {
      "userConfiguration.configuration.inverseX": false,
      "userConfiguration.configuration.inverseY": false,
    },
  },
  { multi: true }
);
