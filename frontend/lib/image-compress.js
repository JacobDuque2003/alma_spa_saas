// Comprime una imagen en el navegador ANTES de subirla. El objetivo es el
// archivo más liviano que se vea bien en un celular, no la máxima calidad —
// estas fotos también las va a enviar un bot de WhatsApp más adelante, y
// WhatsApp Cloud API solo acepta JPEG/PNG en mensajes de imagen normales
// (WebP queda reservado a stickers), así que la salida es siempre JPEG.
const MAX_DIMENSION = 800; // px, lado más largo
const INITIAL_QUALITY = 0.75;
const MIN_QUALITY = 0.35;
const MAX_OUTPUT_BYTES = 300 * 1024; // debe coincidir con MAX_IMAGE_BYTES del servidor

export async function compressImageToDataUrl(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    throw new Error("El archivo debe ser una imagen");
  }

  const objectUrl = URL.createObjectURL(file);
  let img;
  try {
    img = await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const { width, height } = scaledSize(img.naturalWidth, img.naturalHeight, MAX_DIMENSION);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  let quality = INITIAL_QUALITY;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrlByteSize(dataUrl) > MAX_OUTPUT_BYTES && quality > MIN_QUALITY) {
    quality = Math.round((quality - 0.1) * 100) / 100;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  if (dataUrlByteSize(dataUrl) > MAX_OUTPUT_BYTES) {
    throw new Error("No se pudo comprimir la imagen lo suficiente. Prueba con una foto de menor resolución.");
  }

  return { dataUrl, bytes: dataUrlByteSize(dataUrl), width, height, quality };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen"));
    img.src = src;
  });
}

function scaledSize(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const ratio = w > h ? maxDim / w : maxDim / h;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

function dataUrlByteSize(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.ceil((base64.length * 3) / 4) - padding;
}
