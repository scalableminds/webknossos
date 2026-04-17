START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 159 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Fix enforce_non_negative_balance: the old ASSERT used two arguments after the condition
-- (RAISE-style format string + variable), which caused "query returned two columns" when
-- the assertion failed instead of the intended balance error message.
CREATE OR REPLACE FUNCTION webknossos.enforce_non_negative_balance() RETURNS TRIGGER AS $$
BEGIN
  ASSERT (SELECT COALESCE(SUM(milli_credit_delta), 0) + COALESCE(NEW.milli_credit_delta, 0)
          FROM webknossos.credit_transactions_
          WHERE _organization = NEW._organization AND _id != NEW._id) >= 0,
         format('Transaction would result in a negative credit balance for organization %s', NEW._organization);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill column "_related_transaction" for old revoking transactions that only stored the grant
-- reference as text in the comment (format: "Revoked expired credits for transaction {id}").
UPDATE webknossos.credit_transactions
SET _related_transaction = (REGEXP_MATCH(comment, 'for transaction ([0-9a-f]{24})'))[1]
WHERE credit_state = 'Revoking'
  AND _related_transaction IS NULL
  AND comment LIKE 'Revoked expired credits for transaction %'
  AND (REGEXP_MATCH(comment, 'for transaction ([0-9a-f]{24})'))[1] IN (SELECT _id FROM webknossos.credit_transactions);

-- Update the comment of those revoking transactions to match the current format:
-- "Revoked unused complimentary credits (YYYY-MM)", derived from the grant's creation month.
UPDATE webknossos.credit_transactions AS rev
SET comment = 'Revoked unused complimentary credits (' || TO_CHAR(grant_tx.created_at, 'YYYY-MM') || ')'
FROM webknossos.credit_transactions AS grant_tx
WHERE rev.credit_state = 'Revoking'
  AND rev._related_transaction = grant_tx._id
  AND rev.comment LIKE 'Revoked expired credits for transaction %';

UPDATE webknossos.releaseInformation SET schemaVersion = 160;

COMMIT TRANSACTION;
