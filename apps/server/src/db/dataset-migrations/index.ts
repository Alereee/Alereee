import { DatasetBaseline1789500000000 } from './1789500000000-DatasetBaseline';

// The migrations of one dataset's tables (issue #527), run in every dataset
// schema at start and when a dataset is created — `public` included, where
// the baseline is marked as applied. They name no schema: the connection's
// search_path decides where they land. A change to a dictionary table goes
// here, not into ../migrations (docs/migrations.md).
export const datasetMigrations = [DatasetBaseline1789500000000];

/** The table each dataset schema records its applied migrations in */
export const DATASET_MIGRATIONS_TABLE = 'dataset_migrations';
