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
