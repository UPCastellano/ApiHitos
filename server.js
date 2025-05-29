const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Configuración de MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Configuración para subir imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten imágenes (jpeg, jpg, png, gif)'));
  }
});

// Inicializar base de datos
async function initDB() {
  try {
    const connection = await pool.getConnection();
    
    // Crear tabla de etapas si no existe
    await connection.query(`
      CREATE TABLE IF NOT EXISTS etapas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        color VARCHAR(7) NOT NULL DEFAULT '#4f46e5'
      )
    `);
    
    // Crear tabla de hitos si no existe
    await connection.query(`
      CREATE TABLE IF NOT EXISTS hitos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item INT NOT NULL,
        etapa_id INT NOT NULL,
        fecha_inicio DATE NOT NULL,
        ubicacion VARCHAR(255) NOT NULL,
        fecha_finalizacion DATE,
        comentarios TEXT,
        ilustracion VARCHAR(255),
        FOREIGN KEY (etapa_id) REFERENCES etapas(id)
      )
    `);
    
    // Verificar si hay etapas, si no, insertar algunas por defecto
    const [etapas] = await connection.query('SELECT * FROM etapas');
    if (etapas.length === 0) {
      await connection.query(`
        INSERT INTO etapas (nombre, color) VALUES 
        ('Planificación', '#4f46e5'),
        ('Ejecución', '#059669'),
        ('Finalizado', '#b91c1c'),
        ('En espera', '#d97706')
      `);
    }
    
    connection.release();
    console.log('Base de datos inicializada correctamente');
  } catch (error) {
    console.error('Error al inicializar la base de datos:', error);
  }
}

// Rutas para etapas
app.get('/api/etapas', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM etapas ORDER BY id');
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener etapas:', error);
    res.status(500).json({ error: 'Error al obtener etapas' });
  }
});

app.post('/api/etapas', async (req, res) => {
  try {
    const { nombre, color } = req.body;
    const [result] = await pool.query(
      'INSERT INTO etapas (nombre, color) VALUES (?, ?)',
      [nombre, color]
    );
    res.status(201).json({ id: result.insertId, nombre, color });
  } catch (error) {
    console.error('Error al crear etapa:', error);
    res.status(500).json({ error: 'Error al crear etapa' });
  }
});

app.delete('/api/etapas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar si la etapa está en uso
    const [hitos] = await pool.query('SELECT COUNT(*) as count FROM hitos WHERE etapa_id = ?', [id]);
    if (hitos[0].count > 0) {
      return res.status(400).json({ 
        error: 'No se puede eliminar esta etapa porque está siendo utilizada por uno o más hitos' 
      });
    }
    
    await pool.query('DELETE FROM etapas WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error al eliminar etapa:', error);
    res.status(500).json({ error: 'Error al eliminar etapa' });
  }
});

// Rutas para hitos
app.get('/api/hitos', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT h.*, e.nombre as etapa, e.color as etapa_color 
      FROM hitos h 
      JOIN etapas e ON h.etapa_id = e.id 
      ORDER BY h.item
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener hitos:', error);
    res.status(500).json({ error: 'Error al obtener hitos' });
  }
});

app.post('/api/hitos', async (req, res) => {
  try {
    const { item, etapa_id, fecha_inicio, ubicacion, fecha_finalizacion, comentarios, ilustracion } = req.body;
    
    const [result] = await pool.query(
      'INSERT INTO hitos (item, etapa_id, fecha_inicio, ubicacion, fecha_finalizacion, comentarios, ilustracion) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [item, etapa_id, fecha_inicio, ubicacion, fecha_finalizacion || null, comentarios, ilustracion]
    );
    
    res.status(201).json({ id: result.insertId, success: true });
  } catch (error) {
    console.error('Error al crear hito:', error);
    res.status(500).json({ error: 'Error al crear hito' });
  }
});

app.put('/api/hitos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { etapa_id, fecha_inicio, ubicacion, fecha_finalizacion, comentarios, ilustracion } = req.body;
    
    await pool.query(
      'UPDATE hitos SET etapa_id = ?, fecha_inicio = ?, ubicacion = ?, fecha_finalizacion = ?, comentarios = ?, ilustracion = ? WHERE id = ?',
      [etapa_id, fecha_inicio, ubicacion, fecha_finalizacion || null, comentarios, ilustracion, id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error al actualizar hito:', error);
    res.status(500).json({ error: 'Error al actualizar hito' });
  }
});

app.delete('/api/hitos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM hitos WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error al eliminar hito:', error);
    res.status(500).json({ error: 'Error al eliminar hito' });
  }
});

// Ruta para subir imágenes
app.post('/api/upload', upload.single('imagen'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se ha enviado ninguna imagen' });
  }
  
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url });
});

// Iniciar servidor
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
});
                            