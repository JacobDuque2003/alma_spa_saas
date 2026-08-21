const { BadRequestError } = require('./errors');

// Límite deliberadamente bajo: la compresión real ocurre en el navegador
// antes de subir (ver frontend/lib/image-compress.js); esto es el tope de
// defensa en el servidor, no el objetivo de peso normal.
const MAX_IMAGE_BYTES = 300 * 1024; // 300KB

const MAGIC_BYTES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

// El tipo real del archivo se determina por sus primeros bytes, nunca por lo
// que el cliente declaró en el data URL — evita que un archivo renombrado o
// con Content-Type falso se guarde como si fuera una imagen válida.
function sniffMime(buffer) {
  for (const { mime, bytes } of MAGIC_BYTES) {
    if (buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b)) return mime;
  }
  return null;
}

// Acepta "data:image/jpeg;base64,<...>". El navegador ya comprimió la imagen
// antes de generar este data URL (ver image-compress.js).
function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new BadRequestError('image debe ser un data URL base64 (data:<mime>;base64,<contenido>)');
  }
  const match = /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl.trim());
  if (!match) {
    throw new BadRequestError('image debe tener formato data:<mime>;base64,<contenido>');
  }
  let buffer;
  try {
    buffer = Buffer.from(match[1], 'base64');
  } catch {
    throw new BadRequestError('image no es un base64 válido');
  }
  if (buffer.length === 0) {
    throw new BadRequestError('La imagen está vacía');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new BadRequestError(
      `La imagen pesa ${Math.ceil(buffer.length / 1024)}KB — el máximo permitido es ${MAX_IMAGE_BYTES / 1024}KB. Comprime la imagen antes de subirla.`
    );
  }
  const mimeType = sniffMime(buffer);
  if (!mimeType) {
    throw new BadRequestError('La imagen debe ser JPEG o PNG');
  }
  return { buffer, mimeType };
}

const DESCRIPTION_MAX_LENGTH = 500;

function normalizeDescription(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestError('description debe ser texto');
  }
  const trimmed = value.trim();
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    throw new BadRequestError(`description no puede superar ${DESCRIPTION_MAX_LENGTH} caracteres (tiene ${trimmed.length})`);
  }
  return trimmed || null;
}

module.exports = { decodeImageDataUrl, normalizeDescription, MAX_IMAGE_BYTES, DESCRIPTION_MAX_LENGTH };
