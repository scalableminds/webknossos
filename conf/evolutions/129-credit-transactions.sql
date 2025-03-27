START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 128, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;


-- Create the enum types for transaction states and credit states
CREATE TYPE webknossos.credit_transaction_state AS ENUM ('Pending', 'Complete');
CREATE TYPE webknossos.credit_state AS ENUM ('Pending', 'Spent', 'Refunded', 'Revoked', 'PartiallyRevoked', 'Refunding', 'Revoking', 'AddCredits');

CREATE TABLE webknossos.credit_transactions (
    _id CHAR(24) PRIMARY KEY,
    _organization VARCHAR(256) NOT NULL,
    _related_transaction CHAR(24) DEFAULT NULL,
    _paid_job CHAR(24) DEFAULT NULL,
    credit_delta DECIMAL(14, 3) NOT NULL,
    comment TEXT NOT NULL,
    -- The state of the transaction.
    transaction_state webknossos.credit_transaction_state NOT NULL,
    -- The state of the credits of this transaction.
    credit_state webknossos.credit_state NOT NULL,
    expiration_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

--- Create view
CREATE VIEW webknossos.credit_transactions_ as SELECT * FROM webknossos.credit_transactions WHERE NOT is_deleted;

--- Create index (useful for stored procedures)
CREATE INDEX ON webknossos.credit_transactions(credit_state);

--- Add foreign key constraints
ALTER TABLE webknossos.credit_transactions
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE,
  ADD CONSTRAINT paid_job_ref FOREIGN KEY(_paid_job) REFERENCES webknossos.jobs(_id) DEFERRABLE,
  ADD CONSTRAINT related_transaction_ref FOREIGN KEY(_related_transaction) REFERENCES webknossos.credit_transactions(_id) DEFERRABLE;

CREATE FUNCTION webknossos.enforce_non_negative_balance() RETURNS TRIGGER AS $$
  BEGIN
    -- Assert that the new balance is non-negative
    ASSERT (SELECT COALESCE(SUM(credit_delta), 0) + COALESCE(NEW.credit_delta, 0)
            FROM webknossos.credit_transactions
            WHERE _organization = NEW._organization AND _id != NEW._id) >= 0, 'Transaction would result in a negative credit balance for organization %', NEW._organization;
    -- Assertion passed, transaction can go ahead
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER enforce_non_negative_balance_trigger
BEFORE INSERT OR UPDATE ON webknossos.credit_transactions
FOR EACH ROW EXECUTE PROCEDURE webknossos.enforce_non_negative_balance();

-- ObjectId generation function taken and modified from https://thinhdanggroup.github.io/mongo-id-in-postgresql/
CREATE SEQUENCE webknossos.objectid_sequence;

CREATE FUNCTION webknossos.generate_object_id() RETURNS TEXT AS $$
DECLARE
  time_component TEXT;
  machine_id TEXT;
  process_id TEXT;
  counter TEXT;
  result TEXT;
BEGIN
  -- Extract the current timestamp in seconds since the Unix epoch (4 bytes, 8 hex chars)
  SELECT LPAD(TO_HEX(FLOOR(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT), 8, '0') INTO time_component;
  -- Generate a machine identifier using the hash of the server IP (3 bytes, 6 hex chars)
  SELECT SUBSTRING(md5(CAST(inet_server_addr() AS TEXT)) FROM 1 FOR 6) INTO machine_id;
  -- Retrieve the current backend process ID, limited to 2 bytes (4 hex chars)
  SELECT LPAD(TO_HEX(pg_backend_pid() % 65536), 4, '0') INTO process_id;
  -- Generate a counter using a sequence, ensuring it's 3 bytes (6 hex chars)
  SELECT LPAD(TO_HEX(nextval('webknossos.objectid_sequence')::BIGINT % 16777216), 6, '0') INTO counter;
  -- Concatenate all parts to form a 24-character ObjectId
  result := time_component || machine_id || process_id || counter;

  RETURN result;
END;
$$ LANGUAGE plpgsql;


CREATE FUNCTION webknossos.hand_out_monthly_free_credits(free_credits_amount DECIMAL) RETURNS VOID AS $$
DECLARE
    organization_id VARCHAR(256);
    next_month_first_day DATE;
    existing_transaction_count INT;
BEGIN
    -- Calculate the first day of the next month
    next_month_first_day := DATE_TRUNC('MONTH', NOW()) + INTERVAL '1 MONTH';

    -- Loop through all organizations
    FOR organization_id IN (SELECT _id FROM webknossos.organizations) LOOP
        -- Check if there is already a free credit transaction for this organization in the current month
        SELECT COUNT(*) INTO existing_transaction_count
        FROM webknossos.credit_transactions
        WHERE _organization = organization_id
          AND DATE_TRUNC('MONTH', expiration_date) = next_month_first_day;

        -- Insert free credits only if no record exists for this month
        IF existing_transaction_count = 0 THEN
            INSERT INTO webknossos.credit_transactions
                (_id, _organization, credit_delta, comment, transaction_state, credit_state, expiration_date)
            VALUES
                (webknossos.generate_object_id(), organization_id, free_credits_amount,
                 'Free credits for this month', 'Complete', 'Pending', next_month_first_day);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

UPDATE webknossos.releaseInformation SET schemaVersion = 129;

COMMIT TRANSACTION;
