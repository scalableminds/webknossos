START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 160 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Revert revoking transaction comments back to the old format and clear _related_transaction.
-- The old comment embedded the grant ID as text; we reconstruct it from _related_transaction.
UPDATE webknossos.credit_transactions
SET
  comment = 'Revoked expired credits for transaction ' || _related_transaction,
  _related_transaction = NULL
WHERE credit_state = 'Revoking'
  AND _related_transaction IS NOT NULL
  AND comment LIKE 'Revoked unused complimentary credits (%)';

UPDATE webknossos.releaseInformation SET schemaVersion = 159;

COMMIT TRANSACTION;
