START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 126, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- Drop the trigger and its associated function asserting non negative balance
DROP TRIGGER IF EXISTS enforce_non_negative_balance_trigger ON webknossos.organization_credit_transactions;
DROP FUNCTION IF EXISTS webknossos.enforce_non_negative_balance();

-- Drop the foreign key constraints
ALTER TABLE webknossos.organization_credit_transactions
  DROP CONSTRAINT IF EXISTS organization_ref,
  DROP CONSTRAINT IF EXISTS paid_job_ref;

-- Drop the view
DROP VIEW IF EXISTS webknossos.organization_credit_transactions_;

-- Drop the table
DROP TABLE IF EXISTS webknossos.organization_credit_transactions;

-- Drop the enum type
DROP TYPE IF EXISTS webknossos.credit_transaction_state;

UPDATE webknossos.releaseInformation SET schemaVersion = 125;

COMMIT TRANSACTION;
