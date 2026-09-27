declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  export interface HeifEnumValue<Value extends number> {
    value: Value;
  }

  export interface HeifError {
    code: HeifEnumValue<number>;
    subcode: HeifEnumValue<number>;
    message: string;
  }

  /** Opaque embind handle for a parsed HEIF context. */
  export interface HeifContext {
    readonly __heifContext: unique symbol;
  }

  /** Opaque embind handle for an image item inside a context. */
  export interface HeifImageHandle {
    readonly __heifImageHandle: unique symbol;
  }

  /** Opaque embind handle for a decoded image. */
  export interface HeifImage {
    readonly __heifImage: unique symbol;
  }

  export interface HeifDecodedChannel {
    id: HeifEnumValue<number>;
    stride: number;
    width: number;
    height: number;
    data: Uint8Array;
  }

  export interface HeifDecodeResult {
    image: HeifImage;
    width: number;
    height: number;
    chroma: HeifEnumValue<number>;
    colorspace: HeifEnumValue<number>;
    channels: HeifDecodedChannel[];
  }

  export interface LibheifModule {
    heif_error_code: { heif_error_Ok: HeifEnumValue<0> };
    heif_colorspace: { heif_colorspace_RGB: HeifEnumValue<number> };
    heif_chroma: { heif_chroma_interleaved_RGBA: HeifEnumValue<number> };
    heif_channel: { heif_channel_interleaved: HeifEnumValue<number> };
    heif_context_alloc(): HeifContext;
    heif_context_free(context: HeifContext): void;
    heif_context_read_from_memory(context: HeifContext, bytes: Uint8Array): HeifError;
    heif_context_get_number_of_top_level_images(context: HeifContext): number;
    heif_js_context_get_list_of_top_level_image_IDs(context: HeifContext): number[];
    heif_js_context_get_image_handle(context: HeifContext, imageId: number): HeifImageHandle | HeifError;
    heif_js_decode_image2(
      handle: HeifImageHandle,
      colorspace: HeifEnumValue<number>,
      chroma: HeifEnumValue<number>
    ): HeifDecodeResult | HeifError;
    heif_image_handle_release(handle: HeifImageHandle): void;
    heif_image_release(image: HeifImage): void;
  }

  const initLibheif: (options?: Record<string, unknown>) => Promise<LibheifModule>;
  export default initLibheif;
}
