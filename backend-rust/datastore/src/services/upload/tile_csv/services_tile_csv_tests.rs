//! Port of Scala `TileCsvParserTestSuite`, plus the Java parsing details the port has to match.
use super::*;

/// Scala's `csv.linesIterator`.
fn parse(csv: &str) -> DsResult<SectionRange> {
    parse_section_range(csv.lines().map(str::to_owned))
}

fn failure_message(csv: &str) -> String {
    match parse(csv) {
        Err(e) => e.message,
        Ok(range) => panic!("Expected a failure, got {range:?}"),
    }
}

fn range(first: i32, last: i32) -> SectionRange {
    SectionRange { first, last }
}

#[test]
fn extracts_the_section_range_from_continuous_sections_with_an_arbitrary_start() {
    let csv = "5,0,240,./005_000_001_000_n_00.tif\n\
               5,1024,240,./005_000_002_000_n_00.tif\n\
               6,0,240,./006_000_001_000_n_00.tif\n\
               7,0.5,240.25,tiles/007_000_001_000_n_00.tif\n";
    assert_eq!(parse(csv).unwrap(), range(5, 7));
}

#[test]
fn skips_an_optional_header_row_a_bom_blank_lines_and_quotes() {
    let csv = "\u{FEFF}section,x,y,path\n\n\"3\",0,0,\"./a.tif\"\n4,0,0,./b.tif\n\n";
    assert_eq!(parse(csv).unwrap(), range(3, 4));
    // Header detection ignores the case.
    assert_eq!(parse("SECTION,x,y,path\n1,0,0,a\n").unwrap(), range(1, 1));
}

#[test]
fn rejects_gaps_in_the_section_numbers() {
    assert_eq!(
        failure_message("57,0,0,./a.tif\n59,0,0,./b.tif\n"),
        "Section numbers are not continuous: section 58 is missing between 57 and 59."
    );
}

#[test]
fn ignores_additional_columns_after_the_path() {
    assert_eq!(
        parse("1,0,0,./a.tif,extra,0.5\n2,0,0,./b.tif\n").unwrap(),
        range(1, 2)
    );
}

#[test]
fn rejects_rows_with_too_few_columns_with_the_row_number() {
    assert_eq!(
        failure_message("1,0,0,./a.tif\n2,0,./b.tif\n"),
        "Row 2: expected at least 4 columns (section,x,y,path), found 3."
    );
}

#[test]
fn counts_blank_lines_in_the_row_number() {
    assert!(
        failure_message("1,0,0,./a.tif\n\n2,0,./b.tif\n")
            .contains("Row 3: expected at least 4 columns")
    );
}

#[test]
fn names_replaced_csvs_with_the_next_free_version_next_to_the_current_one() {
    let taken = ["tiles.csv", "tiles.v2.csv"];
    let is_taken = |name: &str| taken.contains(&name);
    assert_eq!(
        next_csv_file_name(Some("tiles.csv"), "new.csv", is_taken),
        "tiles.v3.csv"
    );
    assert_eq!(
        next_csv_file_name(Some("tiles.v2.csv"), "new.csv", is_taken),
        "tiles.v3.csv"
    );
}

#[test]
fn names_a_csv_after_the_uploaded_file_if_there_is_no_current_one() {
    assert_eq!(
        next_csv_file_name(None, "my tiles.csv", |_| false),
        "my_tiles.csv"
    );
    assert_eq!(next_csv_file_name(None, ".csv", |_| false), "tiles.csv");
    // Case-insensitive extension, one character per replaced code point.
    assert_eq!(next_csv_file_name(None, "Ä b.CSV", |_| false), "__b.csv");
    assert_eq!(next_csv_file_name(None, "x.v", |_| false), "x.v.csv");
    assert_eq!(next_csv_file_name(None, "x.v12.csv", |_| false), "x.csv");
}

#[test]
fn rejects_non_integer_sections_and_non_numeric_positions() {
    assert_eq!(
        failure_message("two,0,0,./a.tif\n"),
        "Row 1: section number \"two\" is not an integer."
    );
    assert_eq!(
        failure_message("1,left,0,./a.tif\n"),
        "Row 1: position \"left,0\" is not numeric."
    );
}

#[test]
fn rejects_empty_paths_and_paths_outside_of_the_csv_directory() {
    assert_eq!(failure_message("1,0,0,\n"), "Row 1: the path is empty.");
    assert_eq!(
        failure_message("1,0,0,/etc/passwd\n"),
        "Row 1: path \"/etc/passwd\" must be relative to the CSV file."
    );
    assert!(failure_message("1,0,0,./tiles/../../other/a.tif\n").contains("relative to the CSV"));
    assert!(parse("1,0,0,./tiles/../a.tif\n").is_ok());
}

#[test]
fn rejects_empty_files() {
    assert_eq!(failure_message(""), "The CSV file contains no tiles.");
    assert!(failure_message("section,x,y,path\n").contains("no tiles"));
}

#[test]
fn accepts_java_double_syntax_for_positions() {
    for valid in [
        "1",
        "-1.5",
        "+.5",
        "1.",
        "1e3",
        "1.5E-3",
        "2f",
        "2.5D",
        "NaN",
        "-Infinity",
        "0x1p3",
        "0X1.8P-1d",
    ] {
        assert!(is_java_double(valid), "{valid}");
    }
    for invalid in [
        "", ".", "e3", "1e", "inf", "nan", "infinity", "0x1", "1,5", "1.5.2", "--1", "1 2",
    ] {
        assert!(!is_java_double(invalid), "{invalid}");
    }
}

#[test]
fn splits_lines_like_java_readers() {
    let csv = b"1,0,0,a\r\n2,0,0,b\r3,0,0,c\n\n4,0,0,d";
    assert_eq!(parse_section_range_reader(&csv[..]).unwrap(), range(1, 4));
    // Row numbers count `\r`-separated lines too.
    let error = parse_section_range_reader(&b"1,0,0,a\r\r2,0,b"[..]).unwrap_err();
    assert_eq!(
        error.message,
        "Row 3: expected at least 4 columns (section,x,y,path), found 3."
    );
    let error = parse_section_range_reader(&b"1,0,0,a\n2,0,0,\xff\n"[..]).unwrap_err();
    assert_eq!(error.message, "The CSV file could not be read.");
    // An invalid row before malformed input is reported first.
    let error = parse_section_range_reader(&b"x,0,0,a\n\xff\n"[..]).unwrap_err();
    assert!(error.message.starts_with("Row 1:"));
}

#[test]
fn trims_cells_like_java() {
    // Java `trim` strips control characters, but not non-breaking spaces.
    assert_eq!(parse("\u{1}1\u{1}, 0 ,0,a\n").unwrap(), range(1, 1));
    assert!(failure_message("\u{a0}1,0,0,a\n").contains("is not an integer"));
}
