from django.db import migrations, models
from django.db.models.functions import Lower, Trim


CREATE_GLOBAL_EMAIL_GUARDS = r"""
CREATE OR REPLACE FUNCTION core_reject_user_customer_email_conflict()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    normalized_email text := lower(btrim(NEW.email));
BEGIN
    IF TG_OP = 'UPDATE' AND normalized_email = lower(btrim(OLD.email)) THEN
        RETURN NEW;
    END IF;

    -- Serialize cross-table checks for the same email so concurrent registrations cannot race.
    PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email, 0));
    IF EXISTS (
        SELECT 1 FROM "Customer" WHERE lower(btrim(email)) = normalized_email
    ) THEN
        RAISE EXCEPTION 'This email address is already registered.'
            USING ERRCODE = '23505', CONSTRAINT = 'unique_account_email_across_user_customer';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION core_reject_customer_user_email_conflict()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    normalized_email text := lower(btrim(NEW.email));
BEGIN
    IF TG_OP = 'UPDATE' AND normalized_email = lower(btrim(OLD.email)) THEN
        RETURN NEW;
    END IF;

    -- Use the same advisory key as staff writes to close the opposite side of the race.
    PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email, 0));
    IF EXISTS (
        SELECT 1 FROM "User" WHERE lower(btrim(email)) = normalized_email
    ) THEN
        RAISE EXCEPTION 'This email address is already registered.'
            USING ERRCODE = '23505', CONSTRAINT = 'unique_account_email_across_user_customer';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reject_user_customer_email_conflict
BEFORE INSERT OR UPDATE OF email ON "User"
FOR EACH ROW EXECUTE FUNCTION core_reject_user_customer_email_conflict();

CREATE TRIGGER reject_customer_user_email_conflict
BEFORE INSERT OR UPDATE OF email ON "Customer"
FOR EACH ROW EXECUTE FUNCTION core_reject_customer_user_email_conflict();
"""


DROP_GLOBAL_EMAIL_GUARDS = r"""
DROP TRIGGER IF EXISTS reject_user_customer_email_conflict ON "User";
DROP TRIGGER IF EXISTS reject_customer_user_email_conflict ON "Customer";
DROP FUNCTION IF EXISTS core_reject_user_customer_email_conflict();
DROP FUNCTION IF EXISTS core_reject_customer_user_email_conflict();
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0119_inventory_transaction_loss_snapshot")]

    operations = [
        migrations.RemoveConstraint(
            model_name="user",
            name="unique_staff_email_normalized",
        ),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                Lower(Trim("email")), name="unique_staff_email_canonical"
            ),
        ),
        migrations.AddConstraint(
            model_name="customer",
            constraint=models.UniqueConstraint(
                Lower(Trim("email")), name="unique_customer_email_canonical"
            ),
        ),
        migrations.RunSQL(
            sql=CREATE_GLOBAL_EMAIL_GUARDS,
            reverse_sql=DROP_GLOBAL_EMAIL_GUARDS,
        ),
    ]
