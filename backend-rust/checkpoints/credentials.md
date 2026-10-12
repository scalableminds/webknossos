# Credential management checkpoint

Owner: delegated auth_routes_stage2 agent. Owns NEW `src/credentials.rs`, `tests/credentials.rs`, and this checkpoint. Parent owns shared lib/config/Cargo/docs/inventory and centralized cargo execution.

## Actual contracts discovered
No CredentialController or credential HTTP create/delete/list routes exist. Only GET `/datastores/:name/findCredential` -> WKRemoteDataStoreController.findCredential, with required `key` and `credentialId` query parameters. Creation is internal CredentialService during remote dataset exploration. No credential delete/referenced-source cleanup behavior exists to migrate; do not invent endpoints.

## Finished
- `credentials::router() -> Router<AppState>` implements real datastore credential RPC via local SQL; no remote proxy.
- Validates matching live datastore name/key; failures return exact 403 `{granted:false,msg:"Data store could not be found or accessed."}`.
- Credential variants: HttpBasicAuth, HttpToken/XAuthToken, S3AccessKey, GoogleServiceAccount. RPC returns actual secrets only to authenticated datastore service, with owner/org + fully-qualified Play `_type` discriminator. Play 3 local jar confirms `_type`; official docs confirm qualified name: https://www.playframework.com/documentation/3.0.x/ScalaJsonAutomated . No bearer-user endpoint exposing secrets.
- Datastore key is global service authorization per Scala; reads are not limited to owner organization or onlyAllowedOrganization. Deleted datastore/credentials excluded.
- Public reusable `CredentialInput::for_uri(&Url,identifier,secret)` matches URI scheme + optional field selection; `insert_credential(tx,user,input)` derives owner/org from live AuthUser and supports caller transaction and holds identity/multiuser/org shared row locks in multiuser->user->org order to protect against concurrent deactivation/deletion; `store_credential(pool,user,input)` convenience. Plaintext SQL storage matches existing schema/DAO. Input has redacted Debug and no Serialize implementation.
- Unit tests cover scheme/field selection including invalid GS JSON and debug redaction.

## Pending
- Four PG integration tests written for four variant round trips, persistence ownership, caller transaction rollback, key gating/deletion/corrupt-row errors, and no leaked secrets in failure envelopes. Parent compilation/testing in progress; pending results.
- Parent explicitly delegated NEW `src/data_stores.rs`, `tests/data_stores.rs` for actual GET/POST/DELETE datastore registry routes. Will use dataset agent’s exported `pub(crate) datasets::public_datastore_json(pool,name,jobs_enabled)` helper. Separate `data_stores::router(jobs_enabled:bool)` parent wired. Module + five PG tests complete; see data-stores.md checkpoint.
- Parent runs all cargo. No cargo commands run by this agent; previous auth module final eight DB tests passed centrally.

## Limitations / next step
`for_uri` accepts already parsed/normalized Url; remote exploration must handle Scala URI preprocessing, header suffix removal/ZIP paths before calling. Remote RPC exploration routes unimplemented here. Credential module + tests ready for parent verification. Credential and datastore registry files ready for centralized verification; resolve any reported compile/test feedback. Main backend phase; no engine migration.

## Latest verification evidence
Parent centralized PostgreSQL run: all four credential integration tests passed.
