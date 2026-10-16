START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 185 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Drop dependent views
DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;

-- Add the Open_Source and Enterprise plans and replace Custom by Enterprise.
-- Recreates the enum type, since Postgres cannot drop a value from an enum, by temporarily casting to text.
ALTER TABLE webknossos.organizations ALTER COLUMN pricingPlan DROP DEFAULT;
ALTER TABLE webknossos.organizations ALTER COLUMN pricingPlan TYPE VARCHAR(255);
ALTER TABLE webknossos.organization_plan_updates ALTER COLUMN pricingPlan TYPE VARCHAR(255);
UPDATE webknossos.organizations SET pricingPlan = 'Enterprise' WHERE pricingPlan = 'Custom';
UPDATE webknossos.organization_plan_updates SET pricingPlan = 'Enterprise' WHERE pricingPlan = 'Custom';
DROP TYPE webknossos.PRICING_PLANS;
CREATE TYPE webknossos.PRICING_PLANS AS ENUM ('Personal', 'Team', 'Power', 'Team_Trial', 'Power_Trial', 'Open_Source', 'Enterprise');
ALTER TABLE webknossos.organizations ALTER COLUMN pricingPlan TYPE webknossos.PRICING_PLANS USING pricingPlan::webknossos.PRICING_PLANS;
ALTER TABLE webknossos.organizations ALTER COLUMN pricingPlan SET DEFAULT 'Open_Source'::webknossos.PRICING_PLANS;
ALTER TABLE webknossos.organization_plan_updates ALTER COLUMN pricingPlan TYPE webknossos.PRICING_PLANS USING pricingPlan::webknossos.PRICING_PLANS;

-- Open_Source organizations get no AI credits
CREATE OR REPLACE FUNCTION webknossos.hand_out_monthly_free_credits(free_milli_credits_amount INT) RETURNS VOID AS $$
DECLARE
    organization_id TEXT;
    next_month_first_day DATE;
    existing_transaction_count INT;
BEGIN
    -- Calculate the first day of the next month
    next_month_first_day := DATE_TRUNC('MONTH', NOW()) + INTERVAL '1 MONTH';

    -- Loop through all organizations, except for Open_Source ones, which have no access to AI credits
    FOR organization_id IN (SELECT _id FROM webknossos.organizations WHERE pricingPlan <> 'Open_Source') LOOP
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
                 'Complimentary credits (' || TO_CHAR(NOW(), 'YYYY-MM') || ')', 'Complete', 'Pending', next_month_first_day);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Recreate views
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, m.firstName, m.lastName, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 186;

COMMIT TRANSACTION;
