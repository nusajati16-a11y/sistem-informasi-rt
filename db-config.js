// Database Configuration untuk MySQL
// Pastikan MySQL/MariaDB sudah berjalan di XAMPP

const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '', // Default XAMPP password kosong, ubah jika perlu
  database: 'sistem_informasi_rt',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Base config tanpa database (untuk membuat database pertama kali)
const baseConfig = {
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Helper function untuk get pool (akan dibuat saat init)
let pool = null;

const getPool = () => {
  if (!pool) {
    // Jika pool belum ada, buat dengan baseConfig dulu (tanpa database)
    pool = mysql.createPool(baseConfig);
  }
  return pool;
};

// Database wrapper functions untuk kompatibilitas dengan SQLite pattern
const db = {
  // Promise-based query
  query: async (sql, params = []) => {
    try {
      const p = getPool();
      const [rows] = await p.query(sql, params);
      return [null, rows];
    } catch (error) {
      return [error, null];
    }
  },

  // Wrapper untuk db.run (INSERT/UPDATE/DELETE)
  run: function(sql, params, callback) {
    getPool().query(sql, params)
      .then(([rows, fields]) => {
        const result = {
          lastID: rows.insertId || 0,
          changes: rows.affectedRows || 0,
          insertId: rows.insertId || 0,
          affectedRows: rows.affectedRows || 0
        };
        // Buat context seperti SQLite
        const context = {
          lastID: rows.insertId || 0,
          changes: rows.affectedRows || 0
        };
        if (callback) {
          if (callback.length === 2) {
            // callback(err, result)
            callback(null, context);
          } else {
            // callback(err) dengan this.lastID
            callback.call(context, null);
          }
        }
        return result;
      })
      .catch((error) => {
        if (callback) {
          if (callback.length === 2) {
            callback(error, null);
          } else {
            callback.call({ lastID: 0, changes: 0 }, error);
          }
        } else {
          throw error;
        }
      });
  },

  // Wrapper untuk db.get (SELECT single row)
  get: (sql, params, callback) => {
    getPool().query(sql, params)
      .then(([rows]) => {
        const row = rows && rows.length > 0 ? rows[0] : null;
        if (callback) callback(null, row);
        return row;
      })
      .catch((error) => {
        if (callback) callback(error, null);
        else throw error;
      });
  },

  // Wrapper untuk db.all (SELECT multiple rows)
  all: (sql, params, callback) => {
    getPool().query(sql, params)
      .then(([rows]) => {
        if (callback) callback(null, rows);
        return rows;
      })
      .catch((error) => {
        if (callback) callback(error, null);
        else throw error;
      });
  },

  // Initialize tables (run schema)
  initialize: async () => {
    try {
      // Test connection first dan buat database jika belum ada
      console.log('🔄 Connecting to MySQL...');
      const tempPool = mysql.createPool(baseConfig);
      
      try {
        await tempPool.query('SELECT 1');
        console.log('✅ MySQL connection successful');
      } catch (err) {
        await tempPool.end();
        throw new Error(`Cannot connect to MySQL: ${err.message}. Pastikan MySQL/MariaDB sudah berjalan di XAMPP.`);
      }
      
      // Create database if not exists
      await tempPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
      console.log(`✅ Database '${dbConfig.database}' ready`);
      
      // Create pool dengan database yang sudah ada
      if (pool) {
        await pool.end();
      }
      // Recreate pool dengan database yang sudah ada
      pool = mysql.createPool(dbConfig);
      // Test pool baru
      await pool.query('SELECT 1');
      await tempPool.end();

      // Load and execute schema
      const fs = require('fs');
      const path = require('path');
      const schemaPath = path.join(__dirname, 'database.sql');
      
      if (fs.existsSync(schemaPath)) {
        console.log('🔄 Loading database schema...');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // Split by semicolon, filter out CREATE DATABASE and USE statements
        const statements = schema
          .split(';')
          .map(s => {
            // Remove single-line comments
            let cleaned = s.replace(/--.*$/gm, '');
            // Remove multi-line comments
            cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
            return cleaned.trim();
          })
          .filter(s => {
            // Skip empty, CREATE DATABASE, USE, and comment-only statements
            return s && 
                   !s.match(/^CREATE DATABASE/i) && 
                   !s.match(/^USE /i) &&
                   !s.match(/^--/);
          });
        
        let tableCount = 0;
        // Gunakan pool yang sudah dibuat dengan database
        for (const statement of statements) {
          if (statement.trim()) {
            try {
              await pool.query(statement);
              // Count CREATE TABLE statements
              if (statement.match(/^CREATE TABLE/i)) {
                tableCount++;
              }
            } catch (err) {
              // Ignore errors for existing tables
              if (!err.message.includes('already exists') && 
                  !err.message.includes('Duplicate key') &&
                  !err.message.includes('Duplicate column')) {
                console.error('⚠️  Schema error:', err.message.substring(0, 100));
              }
            }
          }
        }
        console.log(`✅ Database schema loaded (${tableCount} tables)`);
      } else {
        console.warn('⚠️  Schema file not found:', schemaPath);
      }

      // Create default admin if not exists
      console.log('🔄 Creating default admin user...');
      const [adminRows] = await pool.query('SELECT * FROM users WHERE role = ?', ['admin']);
      if (adminRows.length === 0) {
        const bcrypt = require('bcrypt');
        const hash = await bcrypt.hash('admin123', 10);
        await pool.query(
          `INSERT INTO users (nik, email, phone, password, role, full_name) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['0000000000000000', 'admin@rt.local', '081234567890', hash, 'admin', 'Administrator']
        );
        console.log('✅ Default admin user created');
        console.log('   NIK: 0000000000000000');
        console.log('   Email: admin@rt.local');
        console.log('   Password: admin123');
      } else {
        console.log('✅ Admin user already exists');
      }

      console.log('✅ Database initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Database initialization error:', error.message);
      if (error.code === 'ECONNREFUSED') {
        console.error('💡 Pastikan MySQL/MariaDB sudah berjalan di XAMPP');
        console.error('💡 Cek apakah service MySQL sudah aktif di XAMPP Control Panel');
      } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        console.error('💡 Cek username dan password MySQL di db-config.js');
      }
      throw error;
    }
  },

  // Close connection
  close: () => {
    return pool.end();
  }
};

module.exports = db;

