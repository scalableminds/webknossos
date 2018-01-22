// Add the flag "tokenType = Authentication" to every token that is currently in the bearerTokenAuthenticator-collection

// --- !Ups
db.bearerTokenAuthenticators.find().forEach(function(elem) {
  elem.tokenType = "Authentication";
  db.bearerTokenAuthenticators.save(elem);
});
// --- !Downs
db.bearerTokenAuthenticators.find().forEach(function(elem) {
  delete elem.tokenType;
  db.bearerTokenAuthenticators.save(elem);
});
