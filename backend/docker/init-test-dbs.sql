-- Runs once when the postgres-test container initialises (its data lives in tmpfs, so on every start).
CREATE DATABASE kobo_shadow OWNER kobo;
CREATE DATABASE kobo_e2e OWNER kobo;
