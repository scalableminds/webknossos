START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 127, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_non_negative_balance_trigger ON webknossos.credit_transactions;
DROP FUNCTION IF EXISTS webknossos.enforce_non_negative_balance();

DROP FUNCTION IF EXISTS webknossos.generate_object_id();
DROP FUNCTION IF EXISTS webknossos.hand_out_monthly_free_credits(free_credits_amount DECIMAL);
DROP SEQUENCE webknossos.objectid_sequence;


ALTER TABLE webknossos.credit_transactions
  DROP CONSTRAINT IF EXISTS organization_ref,
  DROP CONSTRAINT IF EXISTS paid_job_ref,
  DROP CONSTRAINT IF EXISTS related_transaction_ref;

DROP VIEW IF EXISTS webknossos.organization_credit_transactions_;

DROP TABLE IF EXISTS webknossos.credit_transactions;

DROP TYPE IF EXISTS webknossos.credit_transaction_state;
DROP TYPE IF EXISTS webknossos.credit_state;

UPDATE webknossos.releaseInformation SET schemaVersion = 126;

COMMIT TRANSACTION;
