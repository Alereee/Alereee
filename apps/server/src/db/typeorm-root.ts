import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { prepareDatabase } from './datasets';
import { buildTypeOrmOptions } from './typeorm-options';

/**
 * How the connection of the application is opened (issue #527), for
 * `TypeOrmModule.forRootAsync`: the migrations of `public` and of every
 * dataset schema run first and answer the schema of the active dataset.
 * Whatever boots a part of the application on a real database — a test
 * module with a few of its modules — opens it this way too: the tables of a
 * dictionary come from the dataset migrations, which `migrationsRun` of a
 * plain connection knows nothing about.
 */
export const typeOrmRoot: TypeOrmModuleAsyncOptions = {
  useFactory: async () => buildTypeOrmOptions(await prepareDatabase()),
};
