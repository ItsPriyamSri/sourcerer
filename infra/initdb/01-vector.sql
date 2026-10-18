-- pgvector bootstrap for the local compose stack.
-- The schema itself is created by the brain on first use; this only needs to make
-- the extension available, because CREATE EXTENSION requires superuser.

CREATE EXTENSION IF NOT EXISTS vector;
