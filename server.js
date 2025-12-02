const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const db = require('./db-config');

const app = express();
const PORT = 3000;
const LETTER_TYPES = ['death', 'birth', 'mutation', 'other'];

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store');
  }
}));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Session configuration
app.use(session({
  secret: 'sistem-rt-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize database before starting server
(async () => {
  try {
    await db.initialize();
    console.log('✅ Database ready');
    
    // Start server after database is ready
    app.listen(PORT, () => {
      console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to initialize database:', error.message);
    console.error('💡 Pastikan MySQL/MariaDB sudah berjalan di XAMPP');
    process.exit(1);
  }
})();

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Anda harus login terlebih dahulu' });
  }
};

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Akses ditolak. Hanya administrator yang dapat mengakses.' });
  }
};

// Routes

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login page
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/home');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Register page
app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/home');
  }
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Home page (protected) - shows news and announcements
app.get('/home', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Dashboard redirect to home (menu removed)
app.get('/dashboard', requireAuth, (req, res) => {
  res.redirect('/home');
});

// Letter application pages
app.get('/pengajuan-surat', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pengajuan-surat.html'));
});

app.get('/pengajuan-surat/:type', requireAuth, (req, res) => {
  const { type } = req.params;
  if (!LETTER_TYPES.includes(type)) {
    return res.redirect('/pengajuan-surat');
  }
  return res.redirect(`/form-surat?type=${type}`);
});

app.get('/form-surat', requireAuth, (req, res) => {
  const { type } = req.query;
  if (!type || !LETTER_TYPES.includes(type)) {
    return res.redirect('/pengajuan-surat');
  }
  res.sendFile(path.join(__dirname, 'public', 'form-surat.html'));
});

// Payment page
app.get('/pembayaran-iuran', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pembayaran-iuran.html'));
});

// Admin pages
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/pengajuan-surat', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-pengajuan.html'));
});

// API Routes

// Register API
app.post('/api/register', async (req, res) => {
  const { 
    nik, email, phone, password, 
    full_name, place_of_birth, date_of_birth, gender,
    address, rt, rw, kelurahan, kecamatan, city, province, postal_code
  } = req.body;

  // Validation
  if (!nik || !email || !phone || !password || !full_name || !full_name.trim() ||
      !place_of_birth || !place_of_birth.trim() || !date_of_birth ||
      !gender || !address || !address.trim()) {
    return res.status(400).json({ error: 'Semua field wajib harus diisi' });
  }

  if (!['laki-laki', 'perempuan'].includes(gender)) {
    return res.status(400).json({ error: 'Jenis kelamin tidak valid' });
  }

  // Validate NIK format (16 digits)
  if (!/^\d{16}$/.test(nik)) {
    return res.status(400).json({ error: 'NIK harus terdiri dari 16 digit angka' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Format email tidak valid' });
  }

  // Validate phone format (Indonesian phone number)
  if (!/^(\+62|62|0)[0-9]{9,12}$/.test(phone)) {
    return res.status(400).json({ error: 'Format nomor telepon tidak valid' });
  }

  // Check if NIK already exists
  db.get('SELECT * FROM users WHERE nik = ?', [nik], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
    if (row) {
      return res.status(400).json({ error: 'NIK sudah terdaftar' });
    }

    // Check if email already exists
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Terjadi kesalahan server' });
      }
      if (row) {
        return res.status(400).json({ error: 'Email sudah terdaftar' });
      }

      // Hash password
      try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert user with extended data
        db.run(
          `INSERT INTO users (nik, email, phone, password, full_name, place_of_birth, 
           date_of_birth, gender, address, rt, rw, kelurahan, kecamatan, city, province, postal_code) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [nik, email, phone, hashedPassword, full_name.trim(), place_of_birth.trim(), 
           date_of_birth || null, gender, address.trim(), rt || null, rw || null,
           kelurahan || null, kecamatan || null, city || null, province || null, postal_code || null],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Gagal mendaftarkan pengguna' });
            }
            res.json({ 
              success: true, 
              message: 'Registrasi berhasil! Silakan login.',
              userId: this.lastID 
            });
          }
        );
      } catch (error) {
        res.status(500).json({ error: 'Terjadi kesalahan saat enkripsi password' });
      }
    });
  });
});

// Login API
app.post('/api/login', (req, res) => {
  const { nik, password } = req.body;

  if (!nik || !password) {
    return res.status(400).json({ error: 'NIK dan password harus diisi' });
  }

  db.get('SELECT * FROM users WHERE nik = ?', [nik], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
    if (!row) {
      return res.status(401).json({ error: 'NIK atau password salah' });
    }

    try {
      const match = await bcrypt.compare(password, row.password);
      if (match) {
        req.session.user = {
          id: row.id,
          nik: row.nik,
          email: row.email,
          phone: row.phone,
          role: row.role || 'user',
          full_name: row.full_name
        };
        res.json({ 
          success: true, 
          message: 'Login berhasil',
          user: req.session.user
        });
      } else {
        res.status(401).json({ error: 'NIK atau password salah' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Terjadi kesalahan saat verifikasi password' });
    }
  });
});

// Logout API
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal logout' });
    }
    res.json({ success: true, message: 'Logout berhasil' });
  });
});

// Get current user API
app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: 'Tidak ada sesi aktif' });
  }
});

app.get('/profil', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profil.html'));
});

// API Routes - News and Announcements
app.get('/api/news', requireAuth, (req, res) => {
  const type = req.query.type;
  let query = 'SELECT * FROM news';
  const params = [];
  
  if (type && type !== 'all') {
    query += ' WHERE type = ?';
    params.push(type);
  }
  
  query += ' ORDER BY published_date DESC, created_at DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal memuat berita' });
    }
    res.json({ news: rows });
  });
});

app.post('/api/news', requireAuth, requireAdmin, (req, res) => {
  const { title, content, type, published_date } = req.body;
  
  if (!title || !content || !type || !published_date) {
    return res.status(400).json({ error: 'Semua field wajib harus diisi' });
  }
  
  db.run(
    'INSERT INTO news (title, content, type, published_date, author_id) VALUES (?, ?, ?, ?, ?)',
    [title, content, type, published_date, req.session.user.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Gagal mempublikasikan berita' });
      }
      
      // Create notification for all users
      db.all('SELECT id FROM users WHERE role != ?', ['admin'], (err, users) => {
        if (!err && users) {
          users.forEach(user => {
            db.run(
              'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)',
              [user.id, 'news', 'Berita/Pengumuman Baru', title, '/home']
            );
          });
        }
      });
      
      res.json({ success: true, message: 'Berita berhasil dipublikasikan', id: this.lastID });
    }
  );
});

app.delete('/api/news/:id', requireAuth, requireAdmin, (req, res) => {
  db.run('DELETE FROM news WHERE id = ?', [req.params.id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Gagal menghapus berita' });
    }
    res.json({ success: true });
  });
});

// API Routes - Letter Applications
app.post('/api/letter-applications', requireAuth, upload.single('attachment'), (req, res) => {
  const { letter_type, purpose, details } = req.body;
  const userId = req.session.user.id;
  
  if (!letter_type) {
    return res.status(400).json({ error: 'Jenis surat harus dipilih' });
  }
  if (!LETTER_TYPES.includes(letter_type)) {
    return res.status(400).json({ error: 'Jenis surat tidak valid' });
  }
  
  // Generate application ID
  const applicationId = 'SRT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
  
  let parsedDetails = null;
  if (details) {
    try {
      parsedDetails = JSON.parse(details);
    } catch (error) {
      return res.status(400).json({ error: 'Format detail pengajuan tidak valid' });
    }
  }

  const attachmentPath = req.file ? req.file.path : null;
  
  // MySQL JSON column can accept JSON directly or string
  const detailsValue = parsedDetails ? JSON.stringify(parsedDetails) : null;
  
  db.run(
    `INSERT INTO letter_applications (user_id, letter_type, purpose, details, attachment_path, application_id) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, letter_type, purpose || null, detailsValue, attachmentPath, applicationId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Gagal mengajukan surat' });
      }
      
      // Create notification for admin
      db.all('SELECT id FROM users WHERE role = ?', ['admin'], (err, admins) => {
        if (!err && admins) {
          admins.forEach(admin => {
            db.run(
              'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)',
              [admin.id, 'application', 'Pengajuan Surat Baru', `Pengajuan surat baru dengan ID: ${applicationId}`, '/admin']
            );
          });
        }
      });
      
      res.json({ 
        success: true, 
        message: 'Pengajuan berhasil',
        application_id: applicationId,
        id: this.lastID || this.insertId
      });
    }
  );
});

app.get('/api/letter-applications', requireAuth, requireAdmin, (req, res) => {
  db.all(
    `SELECT la.*, u.nik as user_nik, u.full_name as user_name 
     FROM letter_applications la 
     JOIN users u ON la.user_id = u.id 
     ORDER BY la.created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Gagal memuat pengajuan' });
      }
      res.json({ applications: rows.map(parseApplicationRow) });
    }
  );
});

app.get('/api/letter-applications/my', requireAuth, (req, res) => {
  db.all(
    'SELECT * FROM letter_applications WHERE user_id = ? ORDER BY created_at DESC',
    [req.session.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Gagal memuat pengajuan' });
      }
      res.json({ applications: rows.map(parseApplicationRow) });
    }
  );
});

app.get('/api/letter-applications/:id', requireAuth, (req, res) => {
  db.get(
    `SELECT la.*, u.nik as user_nik, u.full_name as user_name, u.email as user_email, 
     u.phone as user_phone, u.place_of_birth, u.date_of_birth, u.gender, 
     u.address, u.rt, u.rw, u.kelurahan, u.kecamatan, u.city, u.province, u.postal_code
     FROM letter_applications la 
     JOIN users u ON la.user_id = u.id 
     WHERE la.id = ?`,
    [req.params.id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Gagal memuat detail' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
      }
      // Check if user is admin or owner
      if (req.session.user.role !== 'admin' && row.user_id !== req.session.user.id) {
        return res.status(403).json({ error: 'Akses ditolak' });
      }
      res.json({ application: parseApplicationRow(row) });
    }
  );
});

app.post('/api/letter-applications/:id/approve', requireAuth, requireAdmin, (req, res) => {
  db.get('SELECT * FROM letter_applications WHERE id = ?', [req.params.id], (err, app) => {
    if (err || !app) {
      return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
    }
    
    // Get user data
    db.get('SELECT * FROM users WHERE id = ?', [app.user_id], (err, user) => {
      if (err || !user) {
        return res.status(500).json({ error: 'Gagal memuat data pengguna' });
      }
      
      // Generate PDF
      generateLetterPDF(app, user, (pdfPath) => {
        // Update application
        db.run(
          'UPDATE letter_applications SET status = ?, pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['approved', pdfPath, req.params.id],
          (err) => {
            if (err) {
              return res.status(500).json({ error: 'Gagal menyetujui pengajuan' });
            }
            
            // Create notification for user
            db.run(
              'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)',
              [app.user_id, 'application', 'Pengajuan Disetujui', `Pengajuan surat Anda (ID: ${app.application_id}) telah disetujui. Surat siap diunduh.`, '/home']
            );
            
            res.json({ success: true, message: 'Pengajuan disetujui', pdf_path: pdfPath });
          }
        );
      });
    });
  });
});

app.post('/api/letter-applications/:id/reject', requireAuth, requireAdmin, (req, res) => {
  const { notes } = req.body;
  
  db.get('SELECT * FROM letter_applications WHERE id = ?', [req.params.id], (err, app) => {
    if (err || !app) {
      return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
    }
    
    db.run(
      'UPDATE letter_applications SET status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['rejected', notes || null, req.params.id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Gagal menolak pengajuan' });
        }
        
        // Create notification for user
        db.run(
          'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)',
          [app.user_id, 'application', 'Pengajuan Ditolak', `Pengajuan surat Anda (ID: ${app.application_id}) telah ditolak.`, '/home']
        );
        
        res.json({ success: true, message: 'Pengajuan ditolak' });
      }
    );
  });
});

app.get('/api/letter-applications/:id/download', requireAuth, (req, res) => {
  db.get('SELECT * FROM letter_applications WHERE id = ?', [req.params.id], (err, app) => {
    if (err || !app) {
      return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
    }
    
    // Check if user is admin or owner
    if (req.session.user.role !== 'admin' && app.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }
    
    if (!app.pdf_path || !fs.existsSync(app.pdf_path)) {
      return res.status(404).json({ error: 'File surat tidak ditemukan' });
    }
    
    res.download(app.pdf_path, `Surat-${app.application_id}.pdf`);
  });
});

// API Routes - Payments
app.post('/api/payments', requireAuth, upload.single('proof'), (req, res) => {
  const { amount, period, payment_method } = req.body;
  const userId = req.session.user.id;
  
  if (!amount || !period || !payment_method) {
    return res.status(400).json({ error: 'Semua field wajib harus diisi' });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'Bukti pembayaran wajib diupload' });
  }
  
  db.run(
    'INSERT INTO payments (user_id, amount, period, payment_method, proof_path) VALUES (?, ?, ?, ?, ?)',
    [userId, amount, period, payment_method, req.file.path],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Gagal melakukan pembayaran' });
      }
      
      // Generate invoice
      generateInvoice(this.lastID, userId, amount, period, payment_method, (invoicePath) => {
        // Update payment with invoice path
        db.run('UPDATE payments SET invoice_path = ? WHERE id = ?', [invoicePath, this.lastID]);
      });
      
      res.json({ 
        success: true, 
        message: 'Pembayaran berhasil',
        payment_id: this.lastID
      });
    }
  );
});

app.get('/api/payments/my', requireAuth, (req, res) => {
  db.all(
    'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC',
    [req.session.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Gagal memuat pembayaran' });
      }
      res.json({ payments: rows });
    }
  );
});

app.get('/api/payments/:id/invoice', requireAuth, (req, res) => {
  db.get('SELECT * FROM payments WHERE id = ?', [req.params.id], (err, payment) => {
    if (err || !payment) {
      return res.status(404).json({ error: 'Pembayaran tidak ditemukan' });
    }
    
    // Check if user is admin or owner
    if (req.session.user.role !== 'admin' && payment.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }
    
    if (!payment.invoice_path || !fs.existsSync(payment.invoice_path)) {
      return res.status(404).json({ error: 'File invoice tidak ditemukan' });
    }
    
    res.download(payment.invoice_path, `Invoice-${payment.id}.pdf`);
  });
});

app.get('/api/payments/all', requireAuth, requireAdmin, (req, res) => {
  db.all(
    `SELECT p.*, 
            u.full_name as user_name, u.nik as user_nik
     FROM payments p
     JOIN users u ON p.user_id = u.id
     ORDER BY p.created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Gagal memuat riwayat pembayaran' });
      }
      res.json({ payments: rows });
    }
  );
});

// API Routes - Notifications
app.get('/api/notifications', requireAuth, (req, res) => {
  db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [req.session.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Gagal memuat notifikasi' });
      }
      res.json({ notifications: rows });
    }
  );
});

app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
  db.run(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.user.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Gagal memperbarui notifikasi' });
      }
      res.json({ success: true });
    }
  );
});

// API Routes - User
app.get('/api/user/:id', requireAuth, (req, res) => {
  const userId = parseInt(req.params.id);
  
  // Check if user is admin or requesting own data
  if (req.session.user.role !== 'admin' && req.session.user.id !== userId) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }
  
  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal memuat data pengguna' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    }
    // Remove password from response
    delete row.password;
    res.json({ user: row });
  });
});

// Admin user management
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  db.all(`SELECT id, nik, email, phone, full_name, place_of_birth, date_of_birth, gender, 
                 address, rt, rw, kelurahan, kecamatan, city, province, postal_code, role, created_at
          FROM users
          ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal memuat daftar pengguna' });
    }
    res.json({ users: rows });
  });
});

app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'ID pengguna tidak valid' });
  }

  const {
    full_name, email, phone, place_of_birth, date_of_birth,
    gender, address, rt, rw, kelurahan, kecamatan,
    city, province, postal_code, role
  } = req.body;

  if (!full_name || !email || !phone || !place_of_birth || !date_of_birth || !gender || !address) {
    return res.status(400).json({ error: 'Semua field wajib diisi' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Format email tidak valid' });
  }

  if (!/^(\+62|62|0)[0-9]{9,12}$/.test(phone)) {
    return res.status(400).json({ error: 'Format nomor telepon tidak valid' });
  }

  if (!['laki-laki', 'perempuan'].includes(gender)) {
    return res.status(400).json({ error: 'Jenis kelamin tidak valid' });
  }

  const normalizedRole = role && ['admin', 'user'].includes(role) ? role : undefined;

  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal memuat data pengguna' });
    }
    if (!existing) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    }

    db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email.trim(), userId], (err, emailRow) => {
      if (err) {
        return res.status(500).json({ error: 'Gagal memeriksa email' });
      }
      if (emailRow) {
        return res.status(400).json({ error: 'Email sudah digunakan pengguna lain' });
      }

      db.get('SELECT id FROM users WHERE phone = ? AND id != ?', [phone.trim(), userId], (err, phoneRow) => {
        if (err) {
          return res.status(500).json({ error: 'Gagal memeriksa nomor telepon' });
        }
        if (phoneRow) {
          return res.status(400).json({ error: 'Nomor telepon sudah digunakan pengguna lain' });
        }

        const applyUpdate = () => {
          db.run(`UPDATE users 
                  SET full_name = ?, email = ?, phone = ?, place_of_birth = ?, date_of_birth = ?, 
                      gender = ?, address = ?, rt = ?, rw = ?, kelurahan = ?, kecamatan = ?, 
                      city = ?, province = ?, postal_code = ?, role = ? 
                  WHERE id = ?`,
            [
              full_name.trim(),
              email.trim(),
              phone.trim(),
              place_of_birth.trim(),
              date_of_birth,
              gender,
              address.trim(),
              rt || null,
              rw || null,
              kelurahan || null,
              kecamatan || null,
              city || null,
              province || null,
              postal_code || null,
              normalizedRole || existing.role,
              userId
            ],
            function(err) {
              if (err) {
                return res.status(500).json({ error: 'Gagal memperbarui pengguna' });
              }
              res.json({ success: true });
            }
          );
        };

        if (existing.role === 'admin' && normalizedRole === 'user') {
          db.get('SELECT COUNT(*) as total FROM users WHERE role = ?', ['admin'], (err, row) => {
            if (err) {
              return res.status(500).json({ error: 'Gagal memeriksa jumlah admin' });
            }
            if (row.total <= 1) {
              return res.status(400).json({ error: 'Tidak dapat mengubah role admin terakhir' });
            }
            applyUpdate();
          });
        } else {
          applyUpdate();
        }
      });
    });
  });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'ID pengguna tidak valid' });
  }

  if (userId === req.session.user.id) {
    return res.status(400).json({ error: 'Anda tidak dapat menghapus akun sendiri' });
  }

  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal memuat data pengguna' });
    }
    if (!user) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    }

    const proceedDeletion = () => {
      db.run('DELETE FROM letter_applications WHERE user_id = ?', [userId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Gagal menghapus pengajuan pengguna' });
        }
        db.run('DELETE FROM payments WHERE user_id = ?', [userId], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Gagal menghapus pembayaran pengguna' });
          }
          db.run('DELETE FROM notifications WHERE user_id = ?', [userId], (err) => {
            if (err) {
              return res.status(500).json({ error: 'Gagal menghapus notifikasi pengguna' });
            }
            db.run('DELETE FROM users WHERE id = ?', [userId], (err) => {
              if (err) {
                return res.status(500).json({ error: 'Gagal menghapus pengguna' });
              }
              res.json({ success: true });
            });
          });
        });
      });
    };

    if (user.role === 'admin') {
      db.get('SELECT COUNT(*) as total FROM users WHERE role = ?', ['admin'], (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Gagal memeriksa jumlah admin' });
        }
        if (row.total <= 1) {
          return res.status(400).json({ error: 'Tidak dapat menghapus admin terakhir' });
        }
        proceedDeletion();
      });
    } else {
      proceedDeletion();
    }
  });
});

function parseApplicationRow(row) {
  if (!row) return row;
  if (row.details) {
    try {
      // MySQL JSON sudah dalam format object, atau bisa string
      row.details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
    } catch (error) {
      row.details = null;
    }
  } else {
    row.details = null;
  }
  return row;
}

// Helper function to generate letter PDF
function generateLetterPDF(application, user, callback) {
  const doc = new PDFDocument({ margin: 50 });
  const filename = `surat-${application.application_id}.pdf`;
  const filepath = path.join(__dirname, 'uploads', filename);
  
  // Ensure uploads directory exists
  if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
  }
  
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);
  
  // Header
  doc.fontSize(16).text('SURAT KETERANGAN', { align: 'center' });
  doc.moveDown();
  
  const letterTypeNames = {
    'death': 'SURAT LAPORAN KEMATIAN',
    'birth': 'SURAT LAPORAN KELAHIRAN',
    'mutation': 'SURAT LAPORAN MUTASI',
    'other': 'SURAT KETERANGAN'
  };
  
  doc.fontSize(14).text(letterTypeNames[application.letter_type] || 'SURAT KETERANGAN', { align: 'center' });
  doc.moveDown(2);
  
  // Content
  doc.fontSize(12);
  doc.text(`Yang bertanda tangan di bawah ini, Ketua RT, menerangkan bahwa:`, { align: 'justify' });
  doc.moveDown();
  
  doc.text(`Nama                : ${user.full_name || '-'}`);
  doc.text(`NIK                 : ${user.nik || '-'}`);
  doc.text(`Tempat/Tgl Lahir    : ${user.place_of_birth || '-'}, ${user.date_of_birth || '-'}`);
  doc.text(`Jenis Kelamin       : ${user.gender || '-'}`);
  doc.text(`Alamat              : ${user.address || '-'}`);
  if (user.rt) doc.text(`RT/RW              : ${user.rt}/${user.rw || '-'}`);
  if (user.kelurahan) doc.text(`Kelurahan          : ${user.kelurahan || '-'}`);
  if (user.kecamatan) doc.text(`Kecamatan          : ${user.kecamatan || '-'}`);
  if (user.city) doc.text(`Kota/Kabupaten     : ${user.city || '-'}`);
  if (user.province) doc.text(`Provinsi           : ${user.province || '-'}`);
  
  doc.moveDown();
  doc.text(`Tujuan Pengajuan: ${application.purpose || '-'}`, { align: 'justify' });
  doc.moveDown(2);
  
  doc.text(`Demikian surat keterangan ini dibuat dengan sebenar-benarnya untuk dapat dipergunakan sebagaimana mestinya.`, { align: 'justify' });
  doc.moveDown(3);
  
  // Signature section
  doc.text('Ketua RT', { align: 'right' });
  doc.moveDown(3);
  doc.text('___________________', { align: 'right' });
  
  // Add electronic signature text
  doc.fontSize(10).text('Tanda Tangan Elektronik', { align: 'right' });
  
  // Footer
  doc.fontSize(10);
  doc.text(`ID Pengajuan: ${application.application_id}`, { align: 'center' });
  doc.text(`Tanggal: ${new Date().toLocaleDateString('id-ID')}`, { align: 'center' });
  
  stream.on('finish', () => {
    callback(filepath);
  });
  
  doc.end();
}

// Helper function to generate invoice PDF
function generateInvoice(paymentId, userId, amount, period, paymentMethod, callback) {
  const doc = new PDFDocument({ margin: 50 });
  const filename = `invoice-${paymentId}.pdf`;
  const filepath = path.join(__dirname, 'uploads', filename);
  
  // Ensure uploads directory exists
  if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
  }
  
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);
  
  // Header
  doc.fontSize(20).text('INVOICE', { align: 'center' });
  doc.fontSize(16).text('PEMBAYARAN IURAN KAS RT', { align: 'center' });
  doc.moveDown(2);
  
  // Invoice details
  doc.fontSize(12);
  doc.text(`No. Invoice: INV-${paymentId}`, { align: 'right' });
  doc.text(`Tanggal: ${new Date().toLocaleDateString('id-ID')}`, { align: 'right' });
  doc.moveDown(2);
  
  // Payment details
  doc.text(`Periode Iuran: ${period}`);
  doc.text(`Metode Pembayaran: ${paymentMethod === 'cash' ? 'Tunai' : 'Transfer'}`);
  doc.moveDown();
  
  // Amount
  doc.fontSize(14);
  doc.text(`Total Pembayaran: Rp ${new Intl.NumberFormat('id-ID').format(amount)}`, { align: 'right' });
  doc.moveDown(3);
  
  // Footer
  doc.fontSize(10);
  doc.text('Terima kasih atas pembayaran Anda.', { align: 'center' });
  doc.text('Invoice ini adalah bukti pembayaran yang sah.', { align: 'center' });
  
  stream.on('finish', () => {
    callback(filepath);
  });
  
  doc.end();
}

