const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const NEW_PASSWORD = process.env.ADMIN_NEW_PASSWORD || process.argv[2];
if (!NEW_PASSWORD) {
  console.error('Usage: ADMIN_NEW_PASSWORD="<password>" node reset_admin_password.js [password]');
  process.exit(1);
}

async function resetAdminPassword() {
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);

  const valid = await bcrypt.compare(NEW_PASSWORD, hash);
  if (!valid) {
    console.error('Hash generation failed, aborting.');
    process.exit(1);
  }

  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'bmonitor_user',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || 'bmonitor',
  });

  const [result] = await pool.execute(
    'UPDATE users SET password_hash = ? WHERE username = ?',
    [hash, 'admin']
  );

  console.log('Rows updated:', result.affectedRows);
  console.log('\n✓ Password admin berhasil direset.');
  console.log('  Username : admin');

  await pool.end();
}

resetAdminPassword().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
