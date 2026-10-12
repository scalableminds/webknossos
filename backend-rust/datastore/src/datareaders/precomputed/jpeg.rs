//! Pure Rust JPEG decoder with Java ImageIO raster layout (gray or BGR).
use crate::{
    datareaders::assert_chunk_size_limit,
    error::{DsError, DsResult},
};
use zune_jpeg::{
    JpegDecoder,
    zune_core::{bytestream::ZCursor, colorspace::ColorSpace, options::DecoderOptions},
};
pub fn decode(input: &[u8]) -> DsResult<Vec<u8>> {
    let error = |e: zune_jpeg::errors::DecodeErrors| {
        DsError::failure(format!("Could not decode JPEG chunk: {e}"))
    };
    let options = DecoderOptions::default()
        .set_max_width(65535)
        .set_max_height(65535)
        .set_strict_mode(true);
    let mut decoder = JpegDecoder::new_with_options(
        ZCursor::new(input),
        options.jpeg_set_out_colorspace(ColorSpace::BGR),
    );
    decoder.decode_headers().map_err(error)?;
    let info = decoder
        .info()
        .ok_or_else(|| DsError::failure("Missing JPEG image header"))?;
    let colorspace = if info.components == 1 {
        ColorSpace::Luma
    } else {
        ColorSpace::BGR
    };
    decoder.set_options(options.jpeg_set_out_colorspace(colorspace));
    let bytes = decoder
        .output_buffer_size()
        .ok_or_else(|| DsError::failure("Invalid JPEG output size"))?;
    assert_chunk_size_limit(i64::try_from(bytes).unwrap_or(i64::MAX))?;
    decoder.decode().map_err(error)
}
