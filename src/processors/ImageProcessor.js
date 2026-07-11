import sharp from "sharp";
import path from "path";
import { CONFIG, STICKER_METADATA } from "../config/constants.js";
import { Exif } from "../utils/Exif.js";

export class ImageProcessor {
  static async toSticker(buffer, options = {}) {
    let pipeline = sharp(buffer)
      .resize(CONFIG.STICKER_SIZE, CONFIG.STICKER_SIZE, {
        fit: "fill",
      })

    if (options.text) {
      pipeline = pipeline
        .png()
        .composite([{ input: createStickerTextOverlay(options.text), top: 0, left: 0 }]);
    }

    const webpBuffer = await pipeline
      .webp({ quality: CONFIG.STICKER_QUALITY })
      .toBuffer();

    return await Exif.writeExif(
      webpBuffer,
      STICKER_METADATA.PACK_NAME,
      STICKER_METADATA.AUTHOR
    );
  }

  static async toPng(buffer) {
    return sharp(buffer).png({ quality: 100 }).toBuffer();
  }

  static async toPdf(buffer) {
    const { data: imageBuffer, info } = await sharp(buffer)
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });

    return createSingleImagePdf(imageBuffer, info.width, info.height);
  }

  static async extractFrame(buffer, pageIndex, outputDir) {
    const framePath = path.join(
      outputDir,
      `frame_${String(pageIndex).padStart(3, "0")}.png`
    );

    await sharp(buffer, { page: pageIndex })
      .resize(CONFIG.STICKER_SIZE, CONFIG.STICKER_SIZE, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toFile(framePath);

    return framePath;
  }

  static async getMetadata(buffer) {
    return sharp(buffer).metadata();
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapStickerText(text) {
  const words = String(text)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 90)
    .split(" ")
    .flatMap((word) => word.match(/.{1,18}/g) || []);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > 18 && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length === 2) break;
  }

  if (current && lines.length < 3) lines.push(current);
  return lines.slice(0, 3);
}

function createStickerTextOverlay(text) {
  const lines = wrapStickerText(text);
  const fontSize = lines.length >= 3 ? 46 : lines.some((line) => line.length > 14) ? 50 : 58;
  const lineHeight = Math.round(fontSize * 1.08);
  const startY = CONFIG.STICKER_SIZE - 34 - ((lines.length - 1) * lineHeight);

  const tspans = lines
    .map((line, index) => (
      `<tspan x="256" y="${startY + (index * lineHeight)}">${escapeXml(line)}</tspan>`
    ))
    .join("");

  return Buffer.from(`
    <svg width="${CONFIG.STICKER_SIZE}" height="${CONFIG.STICKER_SIZE}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <text
        text-anchor="middle"
        font-family="Arial, Helvetica, 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif"
        font-size="${fontSize}"
        font-weight="900"
        fill="#ffffff"
        stroke="#000000"
        stroke-width="10"
        stroke-linejoin="round"
        paint-order="stroke fill"
      >${tspans}</text>
    </svg>
  `);
}

function createSingleImagePdf(jpegBuffer, width, height) {
  const objects = [];
  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;

  objects.push(Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
  objects.push(Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"));
  objects.push(Buffer.from(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
    `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  ));
  objects.push(Buffer.concat([
    Buffer.from(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuffer.length} >>\nstream\n`
    ),
    jpegBuffer,
    Buffer.from("\nendstream\nendobj\n"),
  ]));
  objects.push(Buffer.from(
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream\nendobj\n`
  ));

  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let byteOffset = parts[0].length;

  for (const object of objects) {
    offsets.push(byteOffset);
    parts.push(object);
    byteOffset += object.length;
  }

  const xrefOffset = byteOffset;
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");

  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}
