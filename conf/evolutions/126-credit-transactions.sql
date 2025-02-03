START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 125, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;


-- Create the enum type for transaction states
CREATE TYPE webknossos.credit_transaction_state AS ENUM ('Pending', 'Completed', 'Refunded', 'Revoked', 'Partially Revoked', 'Spent');

-- Create the transactions table
CREATE TABLE webknossos.organization_credit_transactions (
    _id CHAR(24) PRIMARY KEY,
    _organization VARCHAR(256) NOT NULL,
    credit_change DECIMAL(14, 4) NOT NULL,
    refundable_credit_change DECIMAL(14, 4) NOT NULL CHECK (refundable_credit_change >= 0), -- Ensure non-negative values
    refunded_transaction_id CHAR(24) DEFAULT NULL,
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

CREATE FUNCTION webknossos.enforce_non_negative_balance() RETURNS TRIGGER AS $$
  BEGIN
    -- Assert that the new balance is non-negative
    ASSERT (SELECT COALESCE(SUM(credit_change), 0) + COALESCE(NEW.credit_change, 0)
            FROM webknossos.organization_credit_transactions
            WHERE _organization = NEW._organization AND _id != NEW._id) >= 0, 'Transaction would result in a negative credit balance for organization %', NEW._organization;
    -- Allow the transaction
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER enforce_non_negative_balance_trigger
BEFORE INSERT OR UPDATE ON webknossos.organization_credit_transactions
FOR EACH ROW EXECUTE PROCEDURE webknossos.enforce_non_negative_balance();

UPDATE webknossos.releaseInformation SET schemaVersion = 126;

COMMIT TRANSACTION;
