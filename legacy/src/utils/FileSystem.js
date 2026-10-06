import fs from "fs";
import path from "path";

const BASE_PROJECT_DIR = path.resolve(".");

function assertSafePath(target, baseDir = BASE_PROJECT_DIR) {
  const resolved = path.resolve(target);
  const resolvedBase = path.resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(`Path traversal detectado: ${target}`);
  }
}

export class FileSystem {
  static ensureDir(dirPath) {
    assertSafePath(dirPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  static removeDir(dirPath) {
    assertSafePath(dirPath);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
          this.removeDir(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      }
      fs.rmdirSync(dirPath);
    }
  }

  static cleanupFiles(files) {
    files.forEach((file) => {
      try {
        if (!file) return;
        assertSafePath(file);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (e) {
        // Ignora erros de limpeza
      }
    });
  }

  static cleanupDir(dirPath) {
    try {
      if (!dirPath) return;
      assertSafePath(dirPath);
      if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file) => {
          try {
            fs.unlinkSync(path.join(dirPath, file));
          } catch (e) {
            // Ignora erros
          }
        });
      }
    } catch (e) {
      // Ignora erros
    }
  }
}
