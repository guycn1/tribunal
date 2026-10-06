/**
 * @file A small in-memory stand-in for the Supabase client, so suites can run
 * the real compiled backend - its queries included - with no network. Covers
 * only the query shapes the backend actually uses: filtered selects (a list,
 * one row, or a head-only count, returning only the columns named), ordering,
 * inserts (optionally reading the new row back), upserts on a conflict key,
 * and filtered updates.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {object} FakeSupabase
 * @property {object} client Passed to the backend as its Supabase client.
 * @property {Record<string, object[]>} tables The live rows, by table name.
 * @property {{table: string, op: string, values?: object}[]} writes Every
 *   insert, upsert and update, in the order they happened.
 */

/**
 * Builds a fake client over the given rows. The rows are used in place, so a
 * test can read the tables back afterwards to see what the backend wrote.
 *
 * @param {Record<string, object[]>} tables Initial rows, by table name.
 * @param {{failReads?: boolean, missingColumns?: Record<string, string[]>, rejectInsert?: (table: string, row: object) => (string | undefined)}} [options]
 *   failReads makes every select return an error, to exercise the backend's
 *   failure paths. missingColumns names columns a table does not have yet,
 *   as in a database a migration has not reached: a write naming one is
 *   rejected whole, with the error Supabase gives. rejectInsert is asked
 *   about each insert, and a message it returns rejects that insert with
 *   that error - a foreign key the row breaks, say.
 * @returns {FakeSupabase}
 */
function fakeSupabase(tables, options = {}) {
  const writes = [];
  let clock = 0;
  let nextId = 0;
  /**
   * A table's rows, creating the table empty on first use.
   * @param {string} table
   * @returns {object[]}
   */
  const rowsOf = (table) => (tables[table] = tables[table] || []);
  const client = {
    /**
     * Starts a query on `table`, as supabase-js's from() does. The builder's
     * methods mirror supabase-js's and are not documented one by one: each
     * records its part of the query and returns the builder, and awaiting it
     * runs the query.
     * @param {string} table
     * @returns {object}
     */
    from(table) {
      const filters = [];
      let op = 'select';
      let payload = null;
      let conflictKeys = null;
      let headOnly = false;
      let single = null;
      let orderBy = null;
      let returning = false;
      let columns = null;
      /**
       * Whether a row passes every filter so far.
       * @param {object} row
       * @returns {boolean}
       */
      const matches = (row) => filters.every((test) => test(row));
      /**
       * The first column the write names that this table does not have yet.
       * @returns {string | undefined}
       */
      const unknownColumn = () => ((options.missingColumns || {})[table] || []).find((c) => payload && c in payload);
      /**
       * A row cut down to the selected columns, or whole if none were named.
       * @param {object} row
       * @returns {object}
       */
      const project = (row) => (columns ? Object.fromEntries(columns.map((c) => [c, row[c]])) : row);
      const query = {
        select(selected, selectOptions) {
          if (op === 'select') {
            headOnly = Boolean(selectOptions && selectOptions.head);
            if (typeof selected === 'string' && selected.trim() !== '*') columns = selected.split(',').map((c) => c.trim());
          } else returning = true;
          return query;
        },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        neq(column, value) { filters.push((row) => row[column] !== value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        gte(column, value) { filters.push((row) => row[column] >= value); return query; },
        order(column) { orderBy = column; return query; },
        // Ignores its argument: every matching row comes back. No suite
        // stores more rows than the backend's limits, so none can tell.
        limit() { return query; },
        maybeSingle() { single = 'maybe'; return query; },
        single() { single = 'exact'; return query; },
        insert(values) { op = 'insert'; payload = values; return query; },
        upsert(values, upsertOptions) { op = 'upsert'; payload = values; conflictKeys = upsertOptions.onConflict.split(','); return query; },
        update(values) { op = 'update'; payload = values; return query; },
        then(resolve, reject) {
          let result;
          const missing = op === 'insert' || op === 'upsert' ? unknownColumn() : undefined;
          const rejected = op === 'insert' && options.rejectInsert ? options.rejectInsert(table, payload) : undefined;
          if (missing) {
            result = { data: null, error: { message: `Could not find the '${missing}' column of '${table}' in the schema cache` } };
          } else if (rejected) {
            result = { data: null, error: { message: rejected } };
          } else if (op === 'insert') {
            const stamp = String(++clock).padStart(8, '0');
            const row = { id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`, timestamp: stamp, created_at: stamp, updated_at: stamp, ...payload };
            rowsOf(table).push(row);
            writes.push({ table, op });
            result = returning ? { data: single ? row : [row], error: null } : { error: null };
          } else if (op === 'upsert') {
            const rows = rowsOf(table);
            const i = rows.findIndex((row) => conflictKeys.every((key) => row[key] === payload[key]));
            if (i >= 0) rows[i] = { ...rows[i], ...payload };
            else rows.push({ ...payload });
            writes.push({ table, op });
            result = { error: null };
          } else if (op === 'update') {
            rowsOf(table).filter(matches).forEach((row) => Object.assign(row, payload));
            writes.push({ table, op, values: payload });
            result = { error: null };
          } else if (options.failReads) {
            result = { data: null, count: null, error: { message: 'simulated outage' } };
          } else {
            let rows = rowsOf(table).filter(matches);
            if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy]).localeCompare(String(b[orderBy])));
            if (headOnly) result = { count: rows.length, error: null };
            else if (single === 'maybe') result = { data: rows[0] ? project(rows[0]) : null, error: null };
            else if (single === 'exact') result = rows[0] ? { data: project(rows[0]), error: null } : { data: null, error: { message: 'no rows' } };
            else result = { data: rows.map(project), error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { client, tables, writes };
}

/**
 * Points compiled backend code at the fake. The backend reaches Supabase
 * only through getSupabaseClient() in lib/supabase.ts, so replacing that one
 * compiled module is enough; the fake in use is whatever `global.fakeSupabase`
 * holds when a query runs.
 *
 * @param {string} outDir A compileBackend() output directory.
 */
function useFakeSupabase(outDir) {
  fs.writeFileSync(path.join(outDir, 'lib', 'supabase.js'), 'exports.getSupabaseClient = () => global.fakeSupabase;\n');
}

module.exports = { fakeSupabase, useFakeSupabase };
