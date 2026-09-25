import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';

const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'recruitment');
fs.mkdirSync(uploadDir, { recursive: true });

const MAX_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '50', 10);
const MAX_FILE_SIZE = MAX_SIZE_MB * 1024 * 1024;

// Disallowed executable extensions
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.js', '.mjs', '.vbs', '.msi', '.com', '.scr', '.pif', '.hta', '.cpl', '.jar'
]);

// Allowed extensions
const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.pdf', '.docx', '.doc', '.txt'
]);

const storageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBase = crypto.randomBytes(12).toString('hex');
    const storedName = `${Date.now()}-${safeBase}${ext}`;
    cb(null, storedName);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error('Загрузка исполняемых файлов запрещена в целях безопасности'), false);
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`Недопустимый формат файла (${ext}). Разрешены архивы (ZIP, RAR, 7Z), видео (MP4, MOV), фото (JPG, PNG) и документы (PDF, DOCX)`), false);
  }
  cb(null, true);
}

export const uploadMiddleware = multer({
  storage: storageEngine,
  limits: { fileSize: MAX_FILE_SIZE, files: 10, fields: 30, parts: 40 },
  fileFilter
});

/**
 * Storage service abstraction
 */
export const storageService = {
  getUploadDir() {
    return uploadDir;
  },

  getMaxSizeBytes() {
    return MAX_FILE_SIZE;
  },

  getMaxSizeMB() {
    return MAX_SIZE_MB;
  },

  getSafeFilePath(storedName) {
    const safePath = path.resolve(uploadDir, storedName);
    // Path traversal check
    if (!safePath.startsWith(path.resolve(uploadDir))) {
      throw new Error('Недопустимый путь к файлу');
    }
    return safePath;
  },

  deleteFile(storedName) {
    try {
      const p = this.getSafeFilePath(storedName);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch (err) {
      console.error('Failed to delete file:', err.message);
    }
  }
};

export default storageService;
