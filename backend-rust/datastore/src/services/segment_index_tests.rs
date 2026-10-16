    use super::*;

    #[test]
    fn murmur_hash_matches_commons_codec() {
        // Java oracle: Math.abs(MurmurHash3.hash128x64(ByteBuffer.allocate(8).putLong(x).array())(1)).
        let hash = hash_function("murmurhash3_x64_128").unwrap();
        for (x, expected) in [
            (0i64, 984742418921750958i64),
            (1, 9164143957834486442u64 as i64),
            (2, 2983188039803277069),
            (42, 4652386224612382441),
            (123456789, 1106643466084692845),
            (-1, 7575356704511641263),
            (i64::MAX, 5541611926769433220),
            (i64::MIN, 332970308327370340),
            (9007199254740993, 7009409829992723470),
        ] {
            assert_eq!(hash(x), expected, "{x}");
        }
        assert_eq!(hash_function("identity").unwrap()(7), 7);
    }

    #[test]
    fn maps_top_lefts_to_target_mag_buckets() {
        let buckets = top_lefts_to_target_mag_buckets(
            &[
                Vec3Int::new(0, 0, 0),
                Vec3Int::new(1, 0, 0),
                Vec3Int::new(2, 3, 0),
            ],
            Vec3Int::new(2, 2, 1),
        );
        assert_eq!(buckets, [Vec3Int::new(0, 0, 0), Vec3Int::new(1, 1, 0)]);
    }
