// Add the flag "tokenType = Authentication" to every token that is currently in the bearerTokenAuthenticator-collection

// --- !Ups
db.bearerTokenAuthenticators.update({}, { $set: { "tokenType": "Authentication" } }, { multi: true });

// --- !Downs
db.bearerTokenAuthenticators.update({}, { $unset: { "tokenType": "" } }, { multi: true });
