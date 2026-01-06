START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 148 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;


-- 1. Drop triggers and function that depend on credit_delta.
DROP TRIGGER enforce_non_negative_balance_trigger ON webknossos.credit_transactions;
DROP FUNCTION webknossos.enforce_non_negative_balance();
DROP FUNCTION webknossos.hand_out_monthly_free_credits(DECIMAL); -- old signature

-- 2. migrate table
DROP VIEW webknossos.credit_transactions_;
ALTER TABLE webknossos.credit_transactions ADD COLUMN milli_credit_delta INT;
UPDATE webknossos.credit_transactions SET milli_credit_delta = (credit_delta * 1000)::INT;
ALTER TABLE webknossos.credit_transactions ALTER COLUMN milli_credit_delta SET NOT NULL;
ALTER TABLE webknossos.credit_transactions DROP COLUMN credit_delta;
CREATE VIEW webknossos.credit_transactions_ as SELECT * FROM webknossos.credit_transactions WHERE NOT is_deleted;

-- 3. recreate triggers and functions.
CREATE FUNCTION webknossos.enforce_non_negative_balance() RETURNS TRIGGER AS $$
BEGIN
  -- Assert that the new balance is non-negative
    ASSERT (SELECT COALESCE(SUM(mini_credit_delta), 0) + COALESCE(NEW.mini_credit_delta, 0)
    FROM webknossos.credit_transactions
            WHERE _organization = NEW._organization AND _id != NEW._id) >= 0, 'Transaction would result in a negative credit balance for organization %', NEW._organization;
    -- Assertion passed, transaction can go ahead
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_non_negative_balance_trigger
BEFORE INSERT OR UPDATE ON webknossos.credit_transactions
FOR EACH ROW EXECUTE PROCEDURE webknossos.enforce_non_negative_balance();

CREATE FUNCTION webknossos.hand_out_monthly_free_credits(free_milli_credits_amount INT) RETURNS VOID AS $$
DECLARE
    organization_id TEXT;
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
                (webknossos.generate_object_id(), organization_id, free_milli_credits_amount,
                 'Free credits for this month', 'Complete', 'Pending', next_month_first_day);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;


UPDATE webknossos.releaseInformation SET schemaVersion = 149;

COMMIT TRANSACTION;
