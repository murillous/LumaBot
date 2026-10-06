import  webpmux  from "node-webpmux";
const { Image } = webpmux;

export class Exif {
  static async writeExif(imageBuffer, packname, author) {
    const imgId = "com.luma.bot";

    const json = {
      "sticker-pack-id": imgId,
      "sticker-pack-name": packname,
      "sticker-pack-publisher": author,
      "android-app-store-link":
        "https://play.google.com/store/apps/details?id=com.whatsapp",
      "ios-app-store-link":
        "https://itunes.apple.com/app/whatsapp-messenger/id310633997",
    };

    const exifAttr = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
      0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);

    const jsonBuffer = Buffer.from(JSON.stringify(json), "utf-8");
    const exif = Buffer.concat([exifAttr, jsonBuffer]);

    exif.writeUIntLE(jsonBuffer.length, 14, 4);

    const img = new Image();

    await img.load(imageBuffer);

    img.exif = exif;

    return await img.save(null);
  }
}
