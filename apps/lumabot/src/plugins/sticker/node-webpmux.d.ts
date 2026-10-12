// O node-webpmux não publica tipos. Declara só o que o plugin usa: carregar o WebP, trocar o
// chunk EXIF e salvar em memória.
declare module 'node-webpmux' {
  class Image {
    exif: Buffer | null;
    load(source: Buffer): Promise<void>;
    save(path: null): Promise<Buffer>;
  }
  const webpmux: { readonly Image: typeof Image };
  export = webpmux;
}
