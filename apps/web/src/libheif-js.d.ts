declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  export interface HeifDisplayTarget {
    data: Uint8ClampedArray<ArrayBuffer>;
    width: number;
    height: number;
  }

  export interface HeifDecodedImage {
    get_width(): number;
    get_height(): number;
    display(target: HeifDisplayTarget, callback: (result: HeifDisplayTarget | null) => void): void;
  }

  export interface LibheifModule {
    HeifDecoder: new () => {
      decode(buffer: Uint8Array): HeifDecodedImage[];
    };
  }

  const initLibheif: (options?: Record<string, unknown>) => Promise<LibheifModule>;
  export default initLibheif;
}
