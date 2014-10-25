// Update to change the user configuration 'isWritable'
//  - rename configuration.settings to userConfiguration.configuration
//  - remove attributes, that now belong to dataSetConfiguration
//  - create dataSetConfigurations

// Update to add 'isWritable' property to layers

// --- !Ups
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})

// --- !Downs
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})
