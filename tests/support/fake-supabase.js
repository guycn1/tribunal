/**
 * @file A small in-memory stand-in for the Supabase client, so suites can run
 * the real compiled backend - its queries included - with no network. Covers
 * only the query shapes the backend actually uses: filtered selects (a list,
 * one row, or a head-only count), ordering, inserts (optionally reading the
 * new row back), upserts on a conflict key, and filtered updates.
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
 * @param {{failReads?: boolean}} [options] failReads makes every select
 *   return an error, to exercise the backend's failure paths.
 * @returns {FakeSupabase}
 */
function fakeSupabase(tables, options = {}) {
  const writes = [];
  let clock = 0;
  let nextId = 0;
  const rowsOf = (table) => (tables[table] = tables[table] || []);
  const client = {
    from(table) {
      const filters = [];
      let op = 'select';
      let payload = null;
      let conflictKeys = null;
      let headOnly = false;
      let single = null;
      let orderBy = null;
      let returning = false;
      const matches = (row) => filters.every((test) => test(row));
      const query = {
        select(_columns, selectOptions) {
          if (op === 'select') headOnly = Boolean(selectOptions && selectOptions.head);
          else returning = true;
          return query;
        },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        gte(column, value) { filters.push((row) => row[column] >= value); return query; },
        order(column) { orderBy = column; return query; },
        limit() { return query; },
        maybeSingle() { single = 'maybe'; return query; },
        single() { single = 'exact'; return query; },
        insert(values) { op = 'insert'; payload = values; return query; },
        upsert(values, upsertOptions) { op = 'upsert'; payload = values; conflictKeys = upsertOptions.onConflict.split(','); return query; },
        update(values) { op = 'update'; payload = values; return query; },
        then(resolve, reject) {
          let result;
          if (op === 'insert') {
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
            else if (single === 'maybe') result = { data: rows[0] || null, error: null };
            else if (single === 'exact') result = rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
            else result = { data: rows, error: null };
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
