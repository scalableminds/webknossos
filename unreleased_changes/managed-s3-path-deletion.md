### Changed
- Paths in managed S3 that are queued for deletion (e.g. after deleting a dataset) are now deleted by the datastore itself, replacing the separate Python deletion service.

### Migration
- The external S3 path deletion service (`tools/deletion-service`) was removed and should no longer be deployed. Its role is now taken by the datastore, configurable via `datastore.managedS3PathDeletion`. The config key `externalPathDeletionService.key` was removed. The datastore needs a global S3 credential (`datastore.dataVaults.credentials`) that covers the paths to delete.
