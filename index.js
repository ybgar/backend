require('dotenv').config(); // Add this at the very top
const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors()); // Enable CORS
app.use(express.json()); // For parsing JSON requests

// Add console.log to debug environment variables
console.log('Environment variables:', {
  DB_USER: process.env.DB_USER,
  DB_SERVER: process.env.DB_SERVER,
  DB_NAME: process.env.DB_NAME,
  // Don't log password for security
});

// Update dbConfig to provide default values
const dbConfig = {
  user: process.env.DB_USER || 'magangsisfo',
  password: process.env.DB_PASSWORD || 'L0goT3sl4@@',
  server: process.env.DB_SERVER || '172.30.33.47',
  database: process.env.DB_NAME || 'ASABRI_PESERTA',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

// Add error handling for database connection
const connectToDatabase = async () => {
  try {
    console.log('Attempting to connect to the database...');
    console.log('Using server:', dbConfig.server); // Debug log
    
    if (!dbConfig.server) {
      throw new Error('Database server configuration is missing');
    }
    
    await sql.connect(dbConfig);
    console.log('Connected to the database');
  } catch (err) {
    console.error('Error connecting to the database:', err);
    // Retry connection after delay
    setTimeout(connectToDatabase, 5000);
  }
};

// Call the connect function
connectToDatabase();

// API to get data from SQL database
app.get('/api/data', async (req, res) => {
  const { page = 1, limit = 20, offset = (page - 1) * limit } = req.query; // Ambil nilai offset dari query

  // Gunakan offset dalam query SQL
  const sqlQuery = `
    SELECT NRP_NIP, NOPENS, BLNBYR, NIK, PENS_POKOK, KODE_JIWA, JNSBYR, TUNJ_ISTRI, TUNJ_BERAS, JML_BRUTO_SBLM_PJK, NAMA_DUKCAPIL, POT_PPH21, NAMA_KEP
    FROM tax_calculation
    WHERE NAMA_KEP IS NOT NULL
    ORDER BY NRP_NIP OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;

  try {
    // Execute the total count query
    const totalQuery = 'SELECT COUNT(*) AS totalCount FROM tax_calculation WHERE NAMA_KEP IS NOT NULL'; // Update totalQuery to filter null NAMA_KEP

    // Execute the total count query
    const totalResults = await sql.query(totalQuery);
    const totalCount = totalResults.recordset[0].totalCount;

    // Execute the paginated query
    const paginatedResults = await sql.query(sqlQuery);
    console.log('Data diambil dari database:', paginatedResults.recordset); // Log untuk memeriksa data
    res.json({
      recordset: paginatedResults.recordset,
      totalCount: totalCount
    });
  } catch (err) {
    console.error('Error executing query:', err);
    res.status(500).json({ error: err });
  }
});

// Endpoint untuk mengeksekusi script SQL dari `Perhitungan Pajak Bulanan.sql`
app.post('/api/execute-tax-calculation', async (req, res) => {
  // Script SQL `Perhitungan Pajak Bulanan` dimasukkan langsung ke dalam string di sini
  const script = `
    -- Hapus data pajak bulan tertentu jika ada (opsional)
    DELETE FROM tax_calculation WHERE BLNBYR = '202409';

    -- Insert data pajak ke dalam tabel tax_calculation
    INSERT INTO tax_calculation ([BLNBYR], [JNSBYR], NRP_NIP, [NOPENS], [PENS_POKOK], [TUNJ_ISTRI], [TUNJ_ANAK], [TUNJ_BERAS], [TUNJ_LAIN], [JML_BRUTO], [POT_PPH21], [POT_ASKES], [POT_HUTANG], [POT_LAIN], [JML_POTONG], [JML_NETTO], [KODE_JIWA], [PEMBULATAN], [TUNJ_IRJA], [TUNJ_CACAT], JML_BRUTO_SBLM_PJK, [NIK], NAMA_KEP, NAMA_DUKCAPIL)
    SELECT [BLNBYR], [JNSBYR], NRP_NIP, [NOPENS], [PENS_POKOK], [TUNJ_ISTRI], [TUNJ_ANAK], [TUNJ_BERAS], [TUNJ_LAIN], [JML_BRUTO], [POT_PPH21], [POT_ASKES], [POT_HUTANG], [POT_LAIN], [JML_POTONG], [JML_NETTO], [KODE_JIWA], [PEMBULATAN], [TUNJ_IRJA], [TUNJ_CACAT], 
           PENS_POKOK + TUNJ_ISTRI + TUNJ_ANAK + TUNJ_BERAS + ISNULL(TUNJ_IRJA,0) + ISNULL(TUNJ_CACAT,0) JML_BRUTO_SBLM_PJK, 
           ISNULL(ISNULL(p.bp_nik_number, f.bpf_nik_number), NOPENS) NIK, 
           ISNULL(p.bp_name, f.bpf_name) NAMA_KEP, 
           ISNULL(p.bp_name, f.bpf_name) NAMA_DUKCAPIL
    FROM AP3_TBL_YAR_ALL a
    LEFT JOIN peserta p ON a.NOPENS = p.bp_no_pensiun
    LEFT JOIN peserta_family f ON a.NOPENS = f.bpf_no_pensiun
    WHERE BLNBYR = '202409' 
      AND JNSBYR IN (23)
      AND ISNULL(p.bp_name, f.bpf_name) IS NOT NULL;

    -- Update potongan pajak (POT_PPH21) berdasarkan tarif efektif bulanan
    UPDATE s 
    SET s.POT_PPH21 = FLOOR(Tarif_Efektif_Bulanan * A.JML_BRUTO_SBLM_PJK)
    FROM tax_calculation s
    JOIN (
      SELECT nik, SUM(JML_BRUTO_SBLM_PJK) JML_BRUTO_SBLM_PJK, MAX(kode_jiwa) kode_jiwa, 
             CASE SUBSTRING(MAX(kode_jiwa), 1, 1) WHEN 1 THEN 
               CASE SUBSTRING(MAX(kode_jiwa), 2, 1) 
                 WHEN 1 THEN CASE WHEN RIGHT(MAX(kode_jiwa), 1) > 0 THEN 'K' + RIGHT(MAX(kode_jiwa), 1) ELSE 'K0' END 
                 ELSE CASE WHEN RIGHT(MAX(kode_jiwa), 1) > 0 THEN 'TK' + RIGHT(MAX(kode_jiwa), 1) ELSE 'TK0' END 
               END 
             WHEN 0 THEN CASE WHEN RIGHT(MAX(kode_jiwa), 1) > 0 THEN 'TK' + RIGHT(MAX(kode_jiwa), 1) ELSE 'TK0' END 
             END STATUS_PTKP 
      FROM tax_calculation 
      GROUP BY nik
    ) a ON a.nik = s.nik 
    AND a.kode_jiwa = s.KODE_JIWA 
    LEFT JOIN tbl_kategori_ter k ON a.STATUS_PTKP = k.kategori 
    LEFT JOIN tbl_persen_ter p ON p.kategori = k.kategori 
    AND a.JML_BRUTO_SBLM_PJK BETWEEN Penghasilan_Mulai AND Penghasilan_sampai;

    -- Update total potongan pajak
    UPDATE tax_calculation 
    SET JML_POTONG = POT_ASKES + POT_HUTANG + POT_LAIN + POT_PPH21;

    -- Update tunjangan lainnya
    UPDATE tax_calculation 
    SET TUNJ_LAIN = ISNULL(TUNJ_CACAT, 0) + ISNULL(POT_PPH21, 0) + ISNULL(TUNJ_IRJA, 0);

    -- Update jumlah bruto
    UPDATE a 
    SET JML_BRUTO = PENS_POKOK + TUNJ_ISTRI + TUNJ_ANAK + TUNJ_BERAS + TUNJ_LAIN
    FROM tax_calculation a;

    -- Update jumlah netto
    UPDATE a 
    SET JML_NETTO = JML_BRUTO - JML_POTONG
    FROM tax_calculation a;

    -- Pembulatan jumlah netto
    UPDATE a 
    SET JML_NETTO = JML_NETTO + (FLOOR((JML_NETTO + 99) / 100) * 100 - JML_NETTO)
    FROM tax_calculation a;

    -- Update jumlah bruto setelah pembulatan
    UPDATE a 
    SET JML_BRUTO = JML_NETTO + JML_POTONG
    FROM tax_calculation a;

    -- Update pembulatan akhir
    UPDATE a 
    SET PEMBULATAN = JML_BRUTO - (PENS_POKOK + TUNJ_ISTRI + TUNJ_ANAK + TUNJ_BERAS + TUNJ_LAIN)
    FROM tax_calculation a;
  `;

  try {
    // Eksekusi script SQL
    const result = await sql.query(script);
    res.json({ message: 'SQL executed successfully', result });
  } catch (err) {
    console.error('Error executing SQL:', err);
    res.status(500).json({ error: err.message, details: err.originalError });
  }
});

// API to get data with missing fields
app.get('/api/data/missing', async (req, res) => {
  const query = `
    SELECT * FROM tax_calculation
    WHERE jenisBayar IS NULL 
    OR tr IS NULL 
    OR cabang IS NULL 
    OR mitra IS NULL 
    OR MAK IS NULL 
    OR tunjanganIstri IS NULL 
    OR tunjanganAnak IS NULL 
    OR tunjanganBeras IS NULL 
    OR pembulatan IS NULL 
    OR kodeOten IS NULL 
    OR jenisPensiun IS NULL 
    OR UNOR IS NULL 
    OR statusPersyaratan IS NULL;
  `;
  
  try {
    const result = await sql.query(query);
    res.json({ recordset: result.recordset });
  } catch (err) {
    console.error('Error fetching missing data:', err);
    res.status(500).json({ error: err.message });
  }
});

// API to get non-conflicting data
app.get('/api/data/non-conflict', async (req, res) => {
  const sqlQuery = `
    SELECT BLNBYR, JNSBYR, NRP_NIP, NOPENS, PENS_POKOK, TUNJ_ISTRI, TUNJ_ANAK, TUNJ_BERAS, JML_BRUTO,POT_HUTANG, JML_POTONG, JML_NETTO, KODE_JIWA,
    PEMBULATAN, TUNJ_IRJA, TUNJ_CACAT, JML_BRUTO_SBLM_PJK, NIK, NAMA_KEP, NAMA_DUKCAPIL
    FROM tax_calculation
    WHERE NRP_NIP NOT IN (SELECT NRP_NIP FROM TableComponent)
  `;
  
  try {
    const result = await sql.query(sqlQuery);
    res.json({ recordset: result.recordset });
  } catch (err) {
    console.error('Error executing query:', err);
    res.status(500).json({ error: err.message });
  }
});

// Menghapus endpoint yang tidak lagi dibutuhkan untuk memindahkan data
app.post('/api/delete-and-move', async (req, res) => {
  res.status(200).json({ message: 'Endpoint ini tidak lagi digunakan.' });
});

// Endpoint untuk mendapatkan data sesuai dengan ReportingPage
app.get('/api/reporting', async (req, res) => {
  const { month, year, page = 1, limit = 20 } = req.query; // Ambil parameter bulan, tahun, halaman, dan limit
  const offset = (page - 1) * limit; // Hitung offset untuk pagination

  // Validasi parameter bulan dan tahun
  if (isNaN(month) || isNaN(year)) {
    console.error('Invalid month or year parameter:', { month, year });
    return res.status(400).json({ error: 'Invalid month or year parameter' });
  }

  // Query untuk mengambil data berdasarkan bulan dan tahun
  const sqlQuery = `
    SELECT 
      BLNBYR, JNSBYR, NRP_NIP, NOPENS, PENS_POKOK, TUNJ_ISTRI, TUNJ_ANAK, TUNJ_BERAS, JML_BRUTO,
      POT_HUTANG, JML_POTONG, JML_NETTO, KODE_JIWA, PEMBULATAN, TUNJ_IRJA, TUNJ_CACAT,
      JML_BRUTO_SBLM_PJK, NIK, NAMA_KEP, NAMA_DUKCAPIL
    FROM tax_calculation
    WHERE MONTH(BLNBYR) = @month AND YEAR(BLNBYR) = @year
    ORDER BY NRP_NIP
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `;

  try {
    const request = new sql.Request();
    request.input('month', sql.Int, parseInt(month)); // Parameter bulan
    request.input('year', sql.Int, parseInt(year)); // Parameter tahun
    request.input('offset', sql.Int, offset); // Parameter offset
    request.input('limit', sql.Int, parseInt(limit)); // Parameter limit

    const results = await request.query(sqlQuery);
    console.log('Data diterima dari database:', results.recordset); // Log hasil query
    res.json({ recordset: results.recordset, totalCount: results.rowsAffected[0] });
  } catch (err) {
    console.error('Error executing query:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
