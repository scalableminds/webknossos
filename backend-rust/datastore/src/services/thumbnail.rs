//! Scala `DSThumbnailService` + `ImageCreator`: layer data → ARGB image → JPEG.
//!
//! Images are kept as non-premultiplied `0xAARRGGBB` pixels like Java `BufferedImage.getRGB`.
//! Images without alpha (Java `TYPE_3BYTE_BGR` / `TYPE_INT_RGB`) store alpha 0xff.
//! JPEG output uses a pure-Rust baseline encoder at quality 100 with 4:2:0 chroma subsampling and
//! standard Huffman tables like Java ImageIO at quality 1.0; the bytes are not identical to
//! ImageIO's (different DCT/colour conversion rounding).
use crate::{
    error::{DsError, DsResult},
    models::ElementClass,
};

pub const MAX_THUMBNAIL_DIMENSION: i32 = 3000;
const IMAGE_CREATE_FAILED: &str = "Could not create 2d image from underlying image data.";

/// Scala `validateThumbnailDimensions`.
pub fn validate_dimensions(width: i32, height: i32) -> DsResult<()> {
    if width > 0
        && width <= MAX_THUMBNAIL_DIMENSION
        && height > 0
        && height <= MAX_THUMBNAIL_DIMENSION
    {
        Ok(())
    } else {
        Err(DsError::failure(format!(
            "Thumbnail width and height must be between 1 and {MAX_THUMBNAIL_DIMENSION}, got {width}×{height}."
        )))
    }
}

/// Scala `util.image.Color` as produced by `Color.fromHTML` (channels in `[0, 1]`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Color {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

impl Color {
    /// Scala `Color.fromHTML`: `#rrggbb` or `rrggbb`; anything unparsable is `None`.
    pub fn from_html(code: &str) -> Option<Self> {
        let code = code.strip_prefix('#').unwrap_or(code);
        let channel = |range: std::ops::Range<usize>| -> Option<f64> {
            let digits = code.get(range)?;
            // `Integer.valueOf(_, 16)` accepts a leading sign.
            i32::from_str_radix(digits, 16)
                .ok()
                .map(|v| f64::from(v) / 255.0)
        };
        Some(Self {
            r: channel(0..2)?,
            g: channel(2..4)?,
            b: channel(4..6)?,
        })
    }
}

/// An ARGB raster (`width * height` pixels, row-major).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u32>,
    pub has_alpha: bool,
}

/// Scala `ImageCreatorParameters` (minus the size).
#[derive(Debug, Clone, Copy)]
pub struct RenderParameters {
    pub element_class: ElementClass,
    pub intensity_range: Option<(f64, f64)>,
    pub is_segmentation: bool,
    pub color: Option<Color>,
    pub invert_color: bool,
    pub preserve_alpha: bool,
    pub opacity: f64,
}

/// Scala `ElementClass.defaultIntensityRange`.
fn default_intensity_range(element_class: ElementClass) -> (f64, f64) {
    match element_class {
        ElementClass::Uint8 | ElementClass::Uint24 => (0.0, 255.0),
        ElementClass::Uint16 => (0.0, 65535.0),
        ElementClass::Uint32 => (0.0, 4294967295.0),
        ElementClass::Float => (-3.40282347e38, 3.40282347e38),
        ElementClass::Double => (f64::MIN, f64::MAX),
        ElementClass::Int8 => (-128.0, 127.0),
        ElementClass::Int16 => (-32768.0, 32767.0),
        ElementClass::Int32 => (-2147483648.0, 2147483647.0),
        ElementClass::Uint64 | ElementClass::Int64 => (0.0, 255.0),
    }
}

/// Scala `MathUtils.clamp` (`lower.max(x).min(upper)` with IEEE comparisons: NaN → lower).
fn clamp(x: f64, lower: f64, upper: f64) -> f64 {
    let low = if lower <= x { x } else { lower };
    if low <= upper { low } else { upper }
}

/// Java `Math.round(double)` cast to `int`.
fn java_round(x: f64) -> i64 {
    if x.is_nan() {
        0
    } else {
        (x + 0.5).floor() as i64
    }
}

/// Scala `normalizeIntensityImpl`.
fn normalize(value: f64, (lo, hi): (f64, f64)) -> i32 {
    java_round(clamp(
        (clamp(value, lo, hi) - lo) / (hi - lo) * 255.0,
        0.0,
        255.0,
    )) as i32
}

fn gray_value(data: &[u8], idx: usize, element_class: ElementClass) -> DsResult<f64> {
    let bytes = |n: usize| -> [u8; 8] {
        let mut out = [0u8; 8];
        out[..n].copy_from_slice(&data[idx..idx + n]);
        out
    };
    Ok(match element_class {
        ElementClass::Uint8 | ElementClass::Uint24 => f64::from(data[idx]),
        ElementClass::Int8 => f64::from(data[idx] as i8),
        ElementClass::Uint16 => f64::from(u16::from_le_bytes([data[idx], data[idx + 1]])),
        ElementClass::Int16 => f64::from(i16::from_le_bytes([data[idx], data[idx + 1]])),
        ElementClass::Uint32 => f64::from(u32::from_le_bytes(bytes(4)[..4].try_into().unwrap())),
        ElementClass::Int32 => f64::from(i32::from_le_bytes(bytes(4)[..4].try_into().unwrap())),
        ElementClass::Uint64 => u64::from_le_bytes(bytes(8)) as f64,
        ElementClass::Int64 => i64::from_le_bytes(bytes(8)) as f64,
        ElementClass::Float => f64::from(f32::from_le_bytes(bytes(4)[..4].try_into().unwrap())),
        ElementClass::Double => {
            return Err(DsError::failure(
                "Unsupported ElementClass for color layer thumbnail: double",
            ));
        }
    })
}

fn apply_color(value: i32, factor: f64, invert: bool) -> u32 {
    let base = if invert { (value - 255).abs() } else { value };
    // Java `(double).toInt & 0xff`: truncation, saturating.
    ((f64::from(base) * factor) as i32 & 0xff) as u32
}

const COLOR_PERMUTATION_SEQUENCE_LENGTH: i64 = 19;
const COLOR_PERMUTATION_PRIMITIVE_ROOT: f64 = 2.0;

/// Scala `imprecise`: rounding to float32 like the GLSL shader.
fn imprecise(x: f64) -> f64 {
    x as f32 as f64
}

fn glsl_pow(x: f64, y: f64) -> f64 {
    let log2x = imprecise(x.ln() / 2f64.ln());
    imprecise(2f64.powf(y * log2x))
}

fn element_of_permutation(index: i32) -> i64 {
    let one_based = i64::from(index) % COLOR_PERMUTATION_SEQUENCE_LENGTH + 1;
    if one_based == 1 {
        COLOR_PERMUTATION_SEQUENCE_LENGTH
    } else {
        (glsl_pow(COLOR_PERMUTATION_PRIMITIVE_ROOT, one_based as f64).floor() as i64)
            % COLOR_PERMUTATION_SEQUENCE_LENGTH
    }
}

/// Scala `colormapJet`.
fn colormap_jet(x: f64) -> (f64, f64, f64) {
    let c = |v: f64| v.clamp(0.0, 1.0);
    let r = c(if x < 0.89 {
        (x - 0.35) / 0.31
    } else {
        1.0 - ((x - 0.89) / 0.11) * 0.5
    });
    let g = c(if x < 0.64 {
        (x - 0.125) * 4.0
    } else {
        1.0 - (x - 0.64) / 0.27
    });
    let b = c(if x < 0.34 {
        0.5 + (x * 0.5) / 0.11
    } else {
        1.0 - (x - 0.34) / 0.31
    });
    (r, g, b)
}

/// Scala `idToRGB`.
fn id_to_rgb(id: u64, preserve_alpha: bool, opacity_alpha: u32) -> u32 {
    if id == 0 {
        return if preserve_alpha { 0 } else { 0x6464_6464 };
    }
    let significant = ((id & 0xffff) + ((id >> 32) & 0xffff)) as i32;
    let color_index = element_of_permutation(significant);
    let (r, g, b) = colormap_jet(color_index as f64 / COLOR_PERMUTATION_SEQUENCE_LENGTH as f64);
    let byte = |v: f64| (java_round(v * 255.0) as u32) & 0xff;
    let alpha = if preserve_alpha { opacity_alpha } else { 0xff };
    (alpha << 24) | (byte(r) << 16) | (byte(g) << 8) | byte(b)
}

/// Scala `ImageCreator.imageFor` (+ the empty-data fallback of `renderLayerThumbnail`).
pub fn image_for(
    data: &[u8],
    width: usize,
    height: usize,
    params: &RenderParameters,
) -> DsResult<Image> {
    let bpe = params.element_class.bytes_per_element();
    let fallback;
    let data = if data.is_empty() {
        fallback = vec![0u8; width * height * bpe];
        &fallback[..]
    } else {
        data
    };
    let fail = |e: DsError| e.wrap(IMAGE_CREATE_FAILED);
    let range = params
        .intensity_range
        .unwrap_or_else(|| default_intensity_range(params.element_class));
    let opacity_alpha =
        (java_round(clamp(params.opacity, 0.0, 100.0) / 100.0 * 255.0) as u32) & 0xff;
    let color = params.color.unwrap_or(Color {
        r: 1.0,
        g: 1.0,
        b: 1.0,
    });
    let count = data.len() / bpe;
    // `setRGB` reads `width * height` entries and throws if the array is shorter.
    if count < width * height {
        return Err(fail(DsError::failure(format!(
            "java.lang.ArrayIndexOutOfBoundsException: Index {count} out of bounds for length {count}"
        ))));
    }
    let mut pixels = Vec::with_capacity(width * height);
    for i in 0..width * height {
        let idx = i * bpe;
        let argb = if params.is_segmentation {
            let mut id = 0u64;
            for (k, b) in data[idx..idx + bpe].iter().enumerate() {
                id |= u64::from(*b) << (8 * k);
            }
            id_to_rgb(id, params.preserve_alpha, opacity_alpha)
        } else {
            let gray = normalize(
                gray_value(data, idx, params.element_class).map_err(fail)?,
                range,
            );
            if params.element_class == ElementClass::Uint24 {
                (opacity_alpha << 24)
                    | (u32::from(data[idx]) << 16)
                    | (u32::from(data[idx + 1]) << 8)
                    | u32::from(data[idx + 2])
            } else {
                (opacity_alpha << 24)
                    | (apply_color(gray, color.r, params.invert_color) << 16)
                    | (apply_color(gray, color.g, params.invert_color) << 8)
                    | apply_color(gray, color.b, params.invert_color)
            }
        };
        // Opaque image types drop the alpha channel.
        pixels.push(if params.preserve_alpha {
            argb
        } else {
            argb | 0xff00_0000
        });
    }
    Ok(Image {
        width,
        height,
        pixels,
        has_alpha: params.preserve_alpha,
    })
}

/// Scala `resizeIfNeeded`: Java2D `drawImage` with default (nearest neighbour) interpolation onto
/// a new transparent ARGB image.
pub fn resize_if_needed(image: Image, width: usize, height: usize) -> Image {
    if image.width == width && image.height == height {
        return image;
    }
    let mut pixels = Vec::with_capacity(width * height);
    for y in 0..height {
        let sy = (((y as f64 + 0.5) * image.height as f64 / height as f64) as usize)
            .min(image.height - 1);
        for x in 0..width {
            let sx = (((x as f64 + 0.5) * image.width as f64 / width as f64) as usize)
                .min(image.width - 1);
            pixels.push(image.pixels[sy * image.width + sx]);
        }
    }
    Image {
        width,
        height,
        pixels,
        has_alpha: true,
    }
}

fn channel(p: u32, shift: u32) -> u32 {
    (p >> shift) & 0xff
}

/// Java2D `SrcOver` of a non-premultiplied ARGB source onto an opaque destination pixel.
fn src_over(dst: u32, src: u32) -> u32 {
    let a = channel(src, 24);
    let mix = |shift| (channel(src, shift) * a + channel(dst, shift) * (255 - a) + 127) / 255;
    0xff00_0000 | (mix(16) << 16) | (mix(8) << 8) | mix(0)
}

fn blend_additively(images: &[Image], len: usize) -> Vec<u32> {
    let mut accum = vec![0u32; len];
    for image in images {
        for (i, &argb) in image.pixels.iter().take(len).enumerate() {
            let a = channel(argb, 24);
            let existing = accum[i];
            let add = |shift| (channel(existing, shift) + channel(argb, shift) * a / 255).min(255);
            accum[i] = 0xff00_0000 | (add(16) << 16) | (add(8) << 8) | add(0);
        }
    }
    accum
}

fn blend_cover(images: &[Image], len: usize, black_as_transparent: bool) -> Vec<u32> {
    let (mut r, mut g, mut b, mut a) = (
        vec![0f64; len],
        vec![0f64; len],
        vec![0f64; len],
        vec![0f64; len],
    );
    for image in images {
        for (i, &argb) in image.pixels.iter().take(len).enumerate() {
            let (sr, sg, sb) = (channel(argb, 16), channel(argb, 8), channel(argb, 0));
            let src_a = if black_as_transparent && sr == 0 && sg == 0 && sb == 0 {
                0.0
            } else {
                f64::from(channel(argb, 24)) / 255.0
            };
            let d_a = a[i];
            let factor = (1.0 - d_a) * src_a;
            let mixed = factor + d_a;
            if mixed > 0.0 {
                r[i] = (d_a * r[i] + factor * f64::from(sr)) / mixed;
                g[i] = (d_a * g[i] + factor * f64::from(sg)) / mixed;
                b[i] = (d_a * b[i] + factor * f64::from(sb)) / mixed;
            }
            a[i] = mixed;
        }
    }
    (0..len)
        .map(|i| {
            let byte = |v: f64| (java_round(v * a[i]) as u32) & 0xff;
            0xff00_0000 | (byte(r[i]) << 16) | (byte(g[i]) << 8) | byte(b[i])
        })
        .collect()
}

/// Scala `blendLayersToJpeg`: colour layers per blend mode, segmentations alpha-blended on top.
pub fn blend_layers(
    color_images: &[Image],
    segmentation_images: &[Image],
    blend_mode: &str,
    width: usize,
    height: usize,
) -> Image {
    let len = width * height;
    let mut pixels = match blend_mode {
        "Cover" => blend_cover(color_images, len, false),
        "CoverWithBlackAsTransparent" => blend_cover(color_images, len, true),
        _ => blend_additively(color_images, len),
    };
    for image in segmentation_images {
        for (dst, &src) in pixels.iter_mut().zip(&image.pixels) {
            *dst = src_over(*dst, src);
        }
    }
    Image {
        width,
        height,
        pixels,
        has_alpha: false,
    }
}

/// Scala `JPEGWriter` (ImageIO, quality 1.0). Images with alpha cannot be written as JPEG
/// (ImageIO: "Bogus input colorspace").
pub fn to_jpeg(image: &Image) -> DsResult<Vec<u8>> {
    if image.has_alpha {
        return Err(DsError::failure(
            "javax.imageio.IIOException: Bogus input colorspace",
        ));
    }
    let width = u16::try_from(image.width).map_err(DsError::from_exception)?;
    let height = u16::try_from(image.height).map_err(DsError::from_exception)?;
    let rgb: Vec<u8> = image
        .pixels
        .iter()
        .flat_map(|p| {
            [
                channel(*p, 16) as u8,
                channel(*p, 8) as u8,
                channel(*p, 0) as u8,
            ]
        })
        .collect();
    let mut out = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut out, 100);
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::R_4_2_0);
    encoder
        .encode(&rgb, width, height, jpeg_encoder::ColorType::Rgb)
        .map_err(DsError::from_exception)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(element_class: ElementClass) -> RenderParameters {
        RenderParameters {
            element_class,
            intensity_range: None,
            is_segmentation: false,
            color: None,
            invert_color: false,
            preserve_alpha: false,
            opacity: 100.0,
        }
    }

    #[test]
    fn parses_html_colors() {
        assert_eq!(
            Color::from_html("#ff0080"),
            Some(Color {
                r: 1.0,
                g: 0.0,
                b: 128.0 / 255.0
            })
        );
        assert_eq!(Color::from_html("00ff00").map(|c| c.g), Some(1.0));
        assert_eq!(Color::from_html("#fff"), None);
        assert_eq!(Color::from_html("zz0000"), None);
    }

    #[test]
    fn renders_gray_with_intensity_range_and_color() {
        let mut p = params(ElementClass::Uint16);
        p.intensity_range = Some((0.0, 1000.0));
        let data: Vec<u8> = [0u16, 500, 1000, 2000]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let image = image_for(&data, 2, 2, &p).unwrap();
        // 500/1000*255 = 127.5 → Java Math.round → 128.
        assert_eq!(
            image.pixels,
            [0xff000000, 0xff808080, 0xffffffff, 0xffffffff]
        );
        p.color = Color::from_html("#ff0000");
        p.invert_color = true;
        let image = image_for(&data, 2, 2, &p).unwrap();
        assert_eq!(image.pixels[0], 0xffff0000);
        assert_eq!(image.pixels[2], 0xff000000);
    }

    #[test]
    fn segment_colors_follow_the_frontend_permutation() {
        // Java oracle of Scala `idToRGB` (same java.lang.Math calls, float rounding via casts).
        let oracle: [(u64, u32); 12] = [
            (1, 0xff0057ff),
            (2, 0xff3affbc),
            (3, 0xffff4000),
            (7, 0xff66ff91),
            (18, 0xff0000fa),
            (19, 0xff800000),
            (20, 0xff0057ff),
            (65535, 0xffffd500),
            (65536, 0xff800000),
            (4294967296, 0xff0057ff),
            (4294967297, 0xff3affbc),
            (u64::MAX, 0xffbd0000),
        ];
        for (id, expected) in oracle {
            assert_eq!(id_to_rgb(id, false, 0xff), expected, "id {id}");
        }
        let mut p = params(ElementClass::Uint64);
        p.is_segmentation = true;
        let data: Vec<u8> = [0u64, 1].iter().flat_map(|v| v.to_le_bytes()).collect();
        let image = image_for(&data, 2, 1, &p).unwrap();
        assert_eq!(image.pixels, [0xff646464, 0xff0057ff]);
        p.preserve_alpha = true;
        p.opacity = 50.0;
        let image = image_for(&data, 2, 1, &p).unwrap();
        assert_eq!(image.pixels, [0, 0x800057ff]);
    }

    #[test]
    fn short_data_and_double_layers_fail() {
        assert!(image_for(&[1, 2, 3], 2, 2, &params(ElementClass::Uint8)).is_err());
        assert!(image_for(&[0; 8], 1, 1, &params(ElementClass::Double)).is_err());
        // Empty data falls back to zeros.
        let image = image_for(&[], 2, 1, &params(ElementClass::Uint8)).unwrap();
        assert_eq!(image.pixels, [0xff000000, 0xff000000]);
    }

    #[test]
    fn blends_like_java2d() {
        let red = Image {
            width: 1,
            height: 1,
            pixels: vec![0xffff0000],
            has_alpha: true,
        };
        let half_green = Image {
            pixels: vec![0x8000ff00],
            ..red.clone()
        };
        let additive = blend_layers(&[red.clone(), half_green.clone()], &[], "Additive", 1, 1);
        assert_eq!(additive.pixels, [0xffff8000]);
        let cover = blend_layers(&[half_green.clone(), red.clone()], &[], "Cover", 1, 1);
        // dest alpha 128/255 green, then red with factor (1-dA): r = (1-0.502)*255 → 127.
        assert_eq!(cover.pixels, [0xff7f8000]);
        let black = Image {
            pixels: vec![0xff000000],
            ..red.clone()
        };
        let cover_black = blend_layers(
            &[red.clone(), black],
            &[],
            "CoverWithBlackAsTransparent",
            1,
            1,
        );
        assert_eq!(cover_black.pixels, [0xffff0000]);
        let with_segmentation = blend_layers(&[red], &[half_green], "Additive", 1, 1);
        assert_eq!(with_segmentation.pixels, [0xff7f8000]);
    }

    #[test]
    fn resizes_with_nearest_neighbour() {
        let image = Image {
            width: 2,
            height: 1,
            pixels: vec![1, 2],
            has_alpha: false,
        };
        let resized = resize_if_needed(image, 4, 2);
        assert_eq!(resized.pixels, [1, 1, 2, 2, 1, 1, 2, 2]);
        assert!(resized.has_alpha);
    }

    #[test]
    fn encodes_decodable_jpegs() {
        let image = Image {
            width: 16,
            height: 8,
            pixels: vec![0xff336699; 128],
            has_alpha: false,
        };
        let jpeg = to_jpeg(&image).unwrap();
        assert_eq!(&jpeg[..2], [0xff, 0xd8]);
        let decoded =
            zune_jpeg::JpegDecoder::new(zune_jpeg::zune_core::bytestream::ZCursor::new(&jpeg))
                .decode()
                .unwrap();
        assert_eq!(decoded.len(), 16 * 8 * 3);
        for rgb in decoded.chunks(3) {
            for (got, want) in rgb.iter().zip([0x33u8, 0x66, 0x99]) {
                assert!(got.abs_diff(want) <= 2, "{rgb:?}");
            }
        }
        assert!(
            to_jpeg(&Image {
                has_alpha: true,
                ..image
            })
            .is_err()
        );
    }
}
