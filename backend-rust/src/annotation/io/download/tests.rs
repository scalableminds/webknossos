use super::*;

#[test]
fn params_follow_play_binders() {
    assert_eq!(
        parse_download_params(None).unwrap(),
        DownloadParams::default()
    );
    let parsed = parse_download_params(Some(
        "version=7&skipVolumeData=1&volumeDataZipFormat=zarr3&version=9",
    ))
    .unwrap();
    assert_eq!(parsed.version, Some(7));
    assert!(parsed.skip_volume_data);
    assert_eq!(parsed.volume_data_zip_format, VolumeDataZipFormat::Zarr3);
    assert_eq!(
        parse_download_params(Some("volumeDataZipFormat=ZARR3"))
            .unwrap()
            .volume_data_zip_format,
        VolumeDataZipFormat::Wkw
    );
    assert_eq!(
        parse_download_params(Some("version=x"))
            .unwrap_err()
            .message,
        "Cannot parse parameter version as Long: For input string: \"x\""
    );
    assert_eq!(
        parse_download_params(Some("skipVolumeData=yes"))
            .unwrap_err()
            .message,
        "Cannot parse parameter skipVolumeData as Boolean: should be true, false, 0 or 1"
    );
}

#[test]
fn names_and_encoding_match_scala() {
    assert_eq!(normalize("Grüße_Ærø"), "Gruesse_Aeroe");
    assert_eq!(abbreviated_name("Ada Mae", "Love Lace"), "alove_lace");
    assert_eq!(
        java_url_encode_path("a b+c/ä~*.-_.zip"),
        "a%20b%2Bc%2F%C3%A4%7E*.-_.zip"
    );
}
