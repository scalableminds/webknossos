START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 125, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;


-- Create the enum type for transaction states
CREATE TYPE webknossos.credit_transaction_state AS ENUM ('Pending', 'Completed', 'Refunded', 'Revoked', 'Spent');

-- Create the transactions table
CREATE TABLE webknossos.organization_credit_transactions (
    _id CHAR(24) PRIMARY KEY,
    _organization VARCHAR(256) NOT NULL,
    credit_change DECIMAL(14, 4) NOT NULL,
    spent_money DECIMAL(14, 4),
    comment TEXT NOT NULL,
    _paid_job CHAR(24),
    state webknossos.credit_transaction_state NOT NULL,
    expiration_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

--- Create view
CREATE VIEW webknossos.organization_credit_transactions_ as SELECT * FROM webknossos.organization_credit_transactions WHERE NOT is_deleted;

--- Create index (useful for stored procedures)
CREATE INDEX ON webknossos.organization_credit_transactions(state);

--- Add foreign key constraints
ALTER TABLE webknossos.organization_credit_transactions
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE,
  ADD CONSTRAINT paid_job_ref FOREIGN KEY(_paid_job) REFERENCES webknossos.jobs(_id) DEFERRABLE;

CREATE  FUNCTION webknossos.enforce_non_negative_balance() RETURNS TRIGGER AS $$
  DECLARE
    current_balance DECIMAL(14, 4);
    new_balance DECIMAL(14, 4);
  BEGIN
    -- Calculate the current credit balance for the affected organization
    SELECT COALESCE(SUM(credit_change), 0)
    INTO current_balance
    FROM webknossos.organization_credit_transactions
    WHERE _organization = NEW._organization AND _id != NEW._id;
    -- Add the new transaction's credit change to calculate the new balance
    new_balance := current_balance + COALESCE(NEW.credit_change, 0);
    -- Check if the new balance is negative
    IF new_balance < 0 THEN
        RAISE EXCEPTION 'Transaction would result in a negative credit balance for organization %', NEW._organization;
    END IF;
    -- Allow the transaction
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER enforce_non_negative_balance_trigger
BEFORE INSERT OR UPDATE ON webknossos.organization_credit_transactions
FOR EACH ROW EXECUTE PROCEDURE webknossos.enforce_non_negative_balance();


--- Stored procedure to revoke temporary credits from an organization
--- TODO !!!!!! Fix refunded free credits not being revoked !!!!!!
CREATE FUNCTION webknossos.revoke_expired_credits()
RETURNS VOID AS $$
DECLARE
    organization_id VARCHAR(256);
    free_credits_transaction RECORD;
    credits_to_revoke DECIMAL(14, 4) := 0;
    spent_credits_since_then DECIMAL(14, 4) := 0;
    free_credits_spent DECIMAL(14, 4) := 0;
    transaction RECORD;
    revoked_organizations_count INTEGER := 0;
    revoked_credit_count DECIMAL(14, 4) := 0;
BEGIN
    -- Iterate through organizations
    BEGIN
      FOR organization_id IN
          SELECT DISTINCT _organization
          FROM webknossos.organization_credit_transactions
          WHERE expiration_date <= CURRENT_DATE
            AND state = 'Completed'
            AND credit_change > 0
      LOOP
          -- Reset credits to revoke
          credits_to_revoke := 0;
          free_credits_spent := 0;

          -- Iterate through expired credits transactions for this organization starting from the most recent
          FOR free_credits_transaction IN
              SELECT *
              FROM webknossos.organization_credit_transactions
              WHERE _organization = organization_id
                AND expiration_date <= CURRENT_DATE
                AND state = 'Completed'
                AND credit_change > 0
              ORDER BY created_at DESC
          LOOP
              -- Calculate spent credits since the free credit transaction
              SELECT COALESCE(SUM(credit_change), 0)
              INTO spent_credits_since_then
              FROM webknossos.organization_credit_transactions
              WHERE _organization = organization_id
                AND created_at > free_credits_transaction.created_at
                AND credit_change < 0
                AND state = 'Completed';

              -- Spent credits are negative, so we negate them for easier calculation
              spent_credits_since_then := spent_credits_since_then * -1;
              -- Check if the credits have been fully spent
              IF spent_credits_since_then >= (free_credits_transaction.credit_change + free_credits_spent) THEN
                  -- Fully spent, update state to 'SPENT', no need to increase revoked_credit_count
                  free_credits_spent := free_credits_spent + free_credits_transaction.credit_change;
                  UPDATE webknossos.organization_credit_transactions
                  SET state = 'Spent', updated_at = NOW()
                  WHERE id = free_credits_transaction.id;
              ELSE
                  -- Calculate the amount to revoke
                  credits_to_revoke := credits_to_revoke + (free_credits_transaction.credit_change + free_credits_spent - spent_credits_since_then);
                  free_credits_spent := free_credits_spent + spent_credits_since_then;

                  -- Update transaction state to 'REVOKED'
                  UPDATE webknossos.organization_credit_transactions
                  SET state = 'Revoked', updated_at = NOW()
                  WHERE id = free_credits_transaction.id;

                  -- Add the date to the revoked dates set
                  -- (In PostgreSQL, we don't need a set; we will use it for information in the comment)
              END IF;
          END LOOP;

          -- If there are credits to revoke, create a revocation transaction
          IF credits_to_revoke > 0 THEN
              INSERT INTO webknossos.organization_credit_transactions (
                  _organization, credit_change, comment, state, created_at, updated_at
              )
              VALUES (
                  organization_id,
                  -credits_to_revoke,
                  CONCAT('Revoked free credits granted.'),
                  'Completed',
                  CURRENT_TIMESTAMP,
                  CURRENT_TIMESTAMP
              );
              -- Log the revocation action for this organization
              revoked_credit_count := revoked_credit_count + credits_to_revoke;
              revoked_organizations_count := revoked_organizations_count + 1;
          END IF;

      END LOOP;

      -- Final notice about revoked credits
      RAISE NOTICE 'Revoked temporary credits for % organizations, total credits revoked: %', revoked_organizations_count, revoked_credit_count;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'Failed to revoke credits: %', SQLERRM;
        RAISE;
    END;
    COMMIT;
END;
$$ LANGUAGE plpgsql;

UPDATE webknossos.releaseInformation SET schemaVersion = 126;

COMMIT TRANSACTION;
