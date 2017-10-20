// Update user login credentials from SecureSocial to Silhouette

// --- !Ups
db.users.find().forEach(function(elem) {
  elem.loginInfo = { providerID: "credentials", providerKey: elem.email };
  elem.passwordInfo = { hasher: "SCrypt", password: elem.pwdHash };
  db.users.save(elem);
});

// --- !Downs
db.users.find().forEach(function(elem) {
  delete elem.loginInfo;
  delete elem.passwordInfo;
  db.users.save(elem);
});
