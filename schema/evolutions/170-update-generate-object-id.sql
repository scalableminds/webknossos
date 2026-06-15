START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 169 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE OR REPLACE FUNCTION webknossos.generate_object_id() RETURNS TEXT AS $$
DECLARE
  time_component TEXT;
  random_component TEXT;
  counter TEXT;
  result TEXT;
BEGIN
  -- 4 bytes (8 hex chars): seconds since Unix epoch
  SELECT LPAD(TO_HEX(FLOOR(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT), 8, '0') INTO time_component;
  -- 5 bytes (10 hex chars): random value. Spec says should be random per process. This is not easily available in postgres, we do random per call instead.
  SELECT LEFT(REPLACE(gen_random_uuid()::TEXT, '-', ''), 10) INTO random_component;
  -- 3 bytes (6 hex chars): incrementing counter with randomized start
  SELECT LPAD(TO_HEX(nextval('webknossos.objectid_sequence')::BIGINT % 16777216), 6, '0') INTO counter;
  result := time_component || random_component || counter;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

UPDATE webknossos.releaseInformation SET schemaVersion = 170;

COMMIT TRANSACTION;
