export class Logger {
  static info(message) {
    console.log(message);
  }

  static error(message, errorOrDetail = null) {
    const detail =
      typeof errorOrDetail === "string"
        ? errorOrDetail
        : errorOrDetail?.message || errorOrDetail || "";
    console.error(message, detail);
  }

  static warn(message) {
    console.warn(message);
  }

  static debug(message) {
    console.debug(message);
  }
}
