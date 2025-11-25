START TRANSACTION;

# Since we are losing information when removing the property, we cannot set it in the reversion.
# However, this will not create an invalid state since the object is merged with the user config.

UPDATE webknossos.releaseInformation SET schemaVersion = 74;

COMMIT TRANSACTION;
