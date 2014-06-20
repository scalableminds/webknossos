// --- !Ups
db.users.update({}, {$rename: {"configuration.settings": "userConfiguration.configuration"}}, {multi: true})
db.users.update({}, {$unset: {"configuration": 0, "userConfiguration.configuration.brightnessContrastSettings": 0, "userConfiguration.configuration.fourBit": 0, "userConfiguration.configuration.quality": 0, "userConfiguration.configuration.interpolation": 0}, $set: {dataSetConfigurations: {}}}, {multi: true})

// --- !Downs
db.users.update({}, {$rename: {"userConfiguration.configuration": "configuration.settings"}}, {multi: true})
db.users.update({}, {$unset: {dataSetConfigurations: 0, userConfiguration: 0}, $set: {"configuration.settings.brightnessContrastSettings": {"default": {brightness: 0, contrast: 1}, "st08x2": {brightness: 0, contrast: 2.4}, "07x2": {brightness: 0, contrast: 2.4}, "Cortex": {brightness: 55, contrast: 1}}, "configuration.settings.fourBit": false, "configuration.settings.quality": 0, "configuration.settings.interpolation": false}}, {multi: true})

