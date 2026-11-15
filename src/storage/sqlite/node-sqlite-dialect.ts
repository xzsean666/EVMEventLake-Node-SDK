import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";

function toSqlInputValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    ArrayBuffer.isView(value)
  ) {
    return value as SQLInputValue;
  }
  throw new TypeError(
    `Unsupported SQLite input parameter type: ${typeof value}`,
  );
}

class NodeSqliteConnection implements DatabaseConnection {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    return Promise.resolve().then(() => {
      const { sql, parameters } = compiledQuery;
      const statement = this.#database.prepare(sql);
      const sanitizedParameters = parameters.map(toSqlInputValue);

      if (statement.columns().length > 0) {
        const rows = statement.all(...sanitizedParameters) as R[];
        return { rows };
      }

      const { changes, lastInsertRowid } = statement.run(
        ...sanitizedParameters,
      );
      return {
        rows: [],
        ...(lastInsertRowid != null
          ? { insertId: BigInt(lastInsertRowid) }
          : {}),
        ...(changes != null ? { numAffectedRows: BigInt(changes) } : {}),
      };
    });
  }

  async *streamQuery<R>(
    compiledQuery: CompiledQuery,
  ): AsyncIterableIterator<QueryResult<R>> {
    const { sql, parameters } = compiledQuery;
    const statement = this.#database.prepare(sql);
    const sanitizedParameters = parameters.map(toSqlInputValue);

    for (const row of statement.iterate(...sanitizedParameters)) {
      yield await Promise.resolve({
        rows: [row as R],
      });
    }
  }
}

class NodeSqliteDriver implements Driver {
  readonly #database: DatabaseSync;
  readonly #connection: DatabaseConnection;

  constructor(database: DatabaseSync) {
    this.#database = database;
    this.#connection = new NodeSqliteConnection(database);
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  acquireConnection(): Promise<DatabaseConnection> {
    return Promise.resolve(this.#connection);
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("BEGIN"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  async savepoint(
    connection: DatabaseConnection,
    savepointName: string,
  ): Promise<void> {
    await connection.executeQuery(
      CompiledQuery.raw(`SAVEPOINT ${savepointName}`),
    );
  }

  async rollbackToSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
  ): Promise<void> {
    await connection.executeQuery(
      CompiledQuery.raw(`ROLLBACK TO ${savepointName}`),
    );
  }

  async releaseSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
  ): Promise<void> {
    await connection.executeQuery(
      CompiledQuery.raw(`RELEASE ${savepointName}`),
    );
  }

  releaseConnection(): Promise<void> {
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    if (this.#database.isOpen) {
      this.#database.close();
    }
    return Promise.resolve();
  }
}

export class NodeSqliteDialect implements Dialect {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  createDriver(): Driver {
    return new NodeSqliteDriver(this.#database);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}
