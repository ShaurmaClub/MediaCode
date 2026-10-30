import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';

function resolveUploadDir() {
  const dir = process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads', 'recruitment');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
resolveUploadDir();

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
    cb(null, resolveUploadDir());
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

// Magic-byte signatures: the extension alone is client-controlled, so for formats
// with a well known header we also check the real file content.
const SIGNATURES = {
  '.jpg': [[0xFF, 0xD8, 0xFF]],
  '.jpeg': [[0xFF, 0xD8, 0xFF]],
  '.png': [[0x89, 0x50, 0x4E, 0x47]],
  '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]],
  '.pdf': [[0x25, 0x50, 0x44, 0x46]],
  '.zip': [[0x50, 0x4B]],
  '.docx': [[0x50, 0x4B]],
  '.rar': [[0x52, 0x61, 0x72, 0x21]],
  '.7z': [[0x37, 0x7A, 0xBC, 0xAF]],
  '.gz': [[0x1F, 0x8B]],
  '.doc': [[0xD0, 0xCF, 0x11, 0xE0]]
};

/** Returns true when the stored file header matches its extension (or the extension has no known signature). */
export function hasValidSignature(filePath, originalName) {
  const sigs = SIGNATURES[path.extname(originalName || '').toLowerCase()];
  if (!sigs) return true;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    return sigs.some((sig) => n >= sig.length && sig.every((b, i) => buf[i] === b));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Storage service abstraction
 */
export const storageService = {
  getUploadDir() {
    return resolveUploadDir();
  },

  getMaxSizeBytes() {
    return MAX_FILE_SIZE;
  },

  getMaxSizeMB() {
    return MAX_SIZE_MB;
  },

  getSafeFilePath(storedName) {
    const activeUploadDir = resolveUploadDir();
    const safePath = path.resolve(activeUploadDir, storedName);
    // Path traversal check
    const relative = path.relative(path.resolve(activeUploadDir), safePath);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Недопустимый путь к файлу');
    }
    return safePath;
  },

  /** True if every uploaded multer file really looks like its declared type. */
  filesHaveValidContent(files) {
    const activeUploadDir = resolveUploadDir();
    return files.every((f) => hasValidSignature(path.join(activeUploadDir, f.filename), f.originalname));
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
