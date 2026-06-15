START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 170 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE OR REPLACE FUNCTION webknossos.generate_object_id() RETURNS TEXT AS $$
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

UPDATE webknossos.releaseInformation SET schemaVersion = 169;

COMMIT TRANSACTION;
