START TRANSACTION;

-- Update the function definition
CREATE OR REPLACE FUNCTION webknossos.hand_out_monthly_free_credits(free_milli_credits_amount INT) RETURNS VOID AS $$
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
                (_id, _organization, milli_credit_delta, comment, transaction_state, credit_state, expiration_date)
            VALUES
                (webknossos.generate_object_id(), organization_id, free_milli_credits_amount,
                 'Free credits for ' || TO_CHAR(NOW(), 'MM/YYYY'), 'Complete', 'Pending', next_month_first_day);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Update existing credit transaction comments
UPDATE webknossos.credit_transactions
SET comment = 'Free credits for ' || TO_CHAR(created_at, 'MM/YYYY')
WHERE comment = 'Free credits for this month';

UPDATE webknossos.releaseInformation SET schemaVersion = 154;

COMMIT;