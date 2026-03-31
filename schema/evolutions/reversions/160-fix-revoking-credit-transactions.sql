START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 160 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Restore the old enforce_non_negative_balance function (with the two-argument ASSERT bug)
CREATE OR REPLACE FUNCTION webknossos.enforce_non_negative_balance() RETURNS TRIGGER AS $$
BEGIN
  ASSERT (SELECT COALESCE(SUM(milli_credit_delta), 0) + COALESCE(NEW.milli_credit_delta, 0)
          FROM webknossos.credit_transactions_
          WHERE _organization = NEW._organization AND _id != NEW._id) >= 0, 'Transaction would result in a negative credit balance for organization %', NEW._organization;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
