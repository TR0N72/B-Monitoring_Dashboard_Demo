// Regression: mysql2 prepared statements (pool.execute) reject numeric LIMIT/OFFSET
// placeholders on MySQL 8 ("Incorrect arguments to mysqld_stmt_execute").
// Queries with `LIMIT ?` must use pool.query.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'routes');

test.each(fs.readdirSync(dir).filter((f) => f.endsWith('.js')))('%s: no pool.execute with LIMIT ?', (f) => {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const calls = src.split(/pool\.execute\(/).slice(1);
  calls.forEach((c) => {
    const stmt = c.split(/\);\s*\n/)[0];
    expect(stmt).not.toMatch(/LIMIT \?|OFFSET \?/);
  });
  // sensors/actuator/fuzzy build `query` then append LIMIT ?; ensure those use query()
  const m = src.match(/query \+= `[^`]*LIMIT \?[^`]*`;[\s\S]*?pool\.(execute|query)\(query/);
  if (m) expect(m[1]).toBe('query');
});
