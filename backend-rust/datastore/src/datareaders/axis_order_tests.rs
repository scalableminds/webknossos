    use super::*;

    #[test]
    fn axis_order_helpers() {
        assert_eq!(AxisOrder::as_zyx_from_rank(3), AxisOrder::xyz_at(2, 1, 0));
        assert_eq!(AxisOrder::as_cxyz_from_rank(3), AxisOrder::XYZ);
        assert_eq!(AxisOrder::cxyz(), AxisOrder::new(1, 2, Some(3), Some(0)));
        let two_d = AxisOrder::new(1, 0, None, Some(2));
        assert_eq!(two_d.z_with_fallback(), 3);
        assert_eq!(two_d.length(), 4);
        assert_eq!(
            AxisOrder::c_additional_xyz(5),
            AxisOrder::new(2, 3, Some(4), Some(0))
        );
    }

    #[test]
    fn full_axis_order_zyx_with_additional_axis() {
        // physical: t, c, z, y, x
        let axis_order = AxisOrder::new(4, 3, Some(2), Some(1));
        let additional = [AdditionalAxis {
            name: "t".into(),
            bounds: vec![0, 10],
            index: 0,
        }];
        let full =
            FullAxisOrder::from_axis_order_and_additional_axes(5, &axis_order, Some(&additional))
                .unwrap();
        assert_eq!(full.to_string(), "tczyx");
        assert_eq!(full.to_string_wk(), "tcxyz");
        assert_eq!(full.physical_to_wk_permutation(), &[0, 1, 4, 3, 2]);
        assert_eq!(full.wk_slot_of_physical_index(4), 2);
        assert_eq!(
            full.permute_indices_physical_to_wk(&[1, 2, 3, 4, 5]),
            vec![1, 2, 5, 4, 3]
        );
        assert_eq!(
            full.permute_indices_wk_to_physical(&[1, 2, 5, 4, 3]),
            vec![1, 2, 3, 4, 5]
        );
        assert_eq!(full.physical_c_to_wk_f_permutation(), vec![2, 3, 4, 1, 0]);
        assert_eq!(full.physical_f_to_wk_f_permutation(), vec![2, 1, 0, 3, 4]);
        assert_eq!(
            full.to_wk_libs_json(),
            serde_json::json!({"z": 2, "y": 3, "x": 4})
        );
    }

    #[test]
    fn full_axis_order_2d_adapter_and_errors() {
        let full = FullAxisOrder::from_axis_order_and_additional_axes(
            3,
            &AxisOrder::new(1, 0, None, None),
            None,
        )
        .unwrap();
        assert_eq!(full.to_string(), "yxz");
        assert!(
            FullAxisOrder::from_axis_order_and_additional_axes(3, &AxisOrder::cxyz(), None)
                .is_err()
        );
    }
