    use super::*;

    fn header_bytes(side: u8, block_type: u8, voxel_type: u8, bytes_per_voxel: u8) -> Vec<u8> {
        let mut b = b"WKW".to_vec();
        b.extend_from_slice(&[1, side, block_type, voxel_type, bytes_per_voxel]);
        b
    }

    #[test]
    fn parses_header_file() {
        let mut bytes = header_bytes(0x55, 2, 2, 6);
        bytes.extend_from_slice(&0i64.to_le_bytes());
        let header = WkwHeader::parse(&bytes, false).unwrap();
        assert_eq!(header.num_chunks_per_shard_dimension, 32);
        assert_eq!(header.num_voxels_per_chunk_dimension, 32);
        assert_eq!(header.block_type, ChunkType::Lz4);
        assert_eq!(header.data_type, ArrayDataType::U2);
        assert_eq!(header.num_channels, 3);
        assert_eq!(header.jump_table, vec![0]);
        assert_eq!(header.chunk_shape(), &[3, 32, 32, 32]);
        assert_eq!(header.shard_shape(), vec![3, 1024, 1024, 1024]);
        assert_eq!(header.num_bytes_per_chunk(), 32 * 32 * 32 * 6);
        assert_eq!(header.bytes_per_chunk(), 32 * 32 * 32 * 6);
        assert_eq!(header.num_chunks_per_shard(), 32768);
        assert_eq!(header.order(), ArrayOrder::F);
        assert!(header.is_sharded());
        assert_eq!(header.compressor().unwrap(), &Compressor::Lz4);
        assert!(header.dataset_shape().is_none());
        assert_eq!(header.fill_value_number(), JavaNumber::Long(0));
        // header-file round trip (Scala writeTo(isHeaderFile = true))
        assert_eq!(header.write_to(true), bytes);
    }

    #[test]
    fn reads_jump_table_only_for_compressed_data_files() {
        let mut bytes = header_bytes(0x15, 2, 1, 1);
        let table: Vec<i64> = (0..=8).map(|i| 80 + i * 10).collect();
        for t in &table {
            bytes.extend_from_slice(&t.to_le_bytes());
        }
        let (header, consumed) = WkwHeader::parse_with_length(&bytes, true).unwrap();
        assert_eq!(consumed, 80);
        assert_eq!(header.jump_table, table);
        assert_eq!(header.block_lengths(), vec![10; 8]);
        assert_eq!(header.data_offset(), 80);
        assert_eq!(
            WkwHeader::parse(&bytes, false).unwrap().jump_table,
            vec![80]
        );
        // write_to relocates to 8 + 8 * len
        assert_eq!(header.write_to(false), bytes);

        let mut raw = header_bytes(0x15, 1, 1, 1);
        raw.extend_from_slice(&16i64.to_le_bytes());
        let raw_header = WkwHeader::parse(&raw, true).unwrap();
        assert_eq!(raw_header.jump_table, vec![16]);
        assert_eq!(raw_header.compressor().unwrap(), &Compressor::Null);
        assert_eq!(raw_header.block_lengths(), vec![32768; 8]);

        // truncated jump table
        let err = WkwHeader::parse(&bytes[..40], true).unwrap_err();
        assert_eq!(err.message, "java.io.EOFException");
    }

    #[test]
    fn validation_messages_match_scala() {
        let mut bad_magic = b"WKX".to_vec();
        bad_magic.extend_from_slice(&[1, 0x55, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(
            WkwHeader::parse(&bad_magic, false).unwrap_err().message,
            "Error reading WKW header: Invalid magic bytes [expected: [87, 75, 87], actual: [87, 75, 88]]."
        );
        let mut v2 = header_bytes(0x55, 1, 1, 1);
        v2[3] = 2;
        assert_eq!(
            WkwHeader::parse(&v2, false).unwrap_err().message,
            "Error reading WKW header: Unknown version [expected: 1, actual: 2]."
        );
        assert_eq!(
            WkwHeader::parse(&header_bytes(0xa5, 1, 1, 1), false)
                .unwrap_err()
                .message,
            "Error reading WKW header: Specified fileSideLength not supported [expected: 1024, actual: [0, 1024)]."
        );
        let err = WkwHeader::parse(&header_bytes(0x55, 4, 1, 1), false).unwrap_err();
        assert_eq!(
            err.message,
            "Error reading WKW header: Specified blockType is not supported."
        );
        assert_eq!(
            err.chain,
            vec!["key not found: 4 java.util.NoSuchElementException: key not found: 4"]
        );
        let err = WkwHeader::parse(&header_bytes(0x55, 1, 11, 1), false).unwrap_err();
        assert_eq!(
            err.message,
            "Error reading WKW header: Specified voxelType is not supported."
        );
        // validation happens before the jump table is read
        assert_eq!(
            WkwHeader::parse(&header_bytes(0x55, 1, 1, 1), false)
                .unwrap_err()
                .message,
            "java.io.EOFException"
        );
        assert_eq!(
            WkwHeader::parse(b"WK", false).unwrap_err().message,
            "Unexpected read size, current: 2, expected: 3"
        );
    }

    #[test]
    fn file_paths() {
        assert_eq!(wkw_file_path(1, 2, 3), "z3/y2/x1.wkw");
        assert_eq!(
            wkw_bucket_file_path(Vec3Int::new(2, 2, 1), Vec3Int::new(4, 5, 6)),
            "2-2-1/z6/y5/x4.wkw"
        );
        assert_eq!(
            wkw_bucket_file_path(Vec3Int::new(4, 4, 4), Vec3Int::new(0, 0, 1)),
            "4/z1/y0/x0.wkw"
        );
        assert_eq!(
            parse_wkw_file_path("layer/2-2-1/z6/y5/x4.wkw"),
            Some((Vec3Int::new(2, 2, 1), Vec3Int::new(256, 320, 192)))
        );
        assert_eq!(
            parse_wkw_file_path("4/z1/y0/x0.wkw"),
            Some((Vec3Int::new(4, 4, 4), Vec3Int::new(0, 0, 128)))
        );
        assert_eq!(parse_wkw_file_path("z1/y0/x0.wkw"), None);
        assert_eq!(parse_wkw_file_path("a/z1/y0/x0.wkw"), None);
        assert_eq!(parse_wkw_file_path("1/z1/y0/x0.wkx"), None);
    }
