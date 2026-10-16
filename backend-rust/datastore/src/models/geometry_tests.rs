    use super::*;
    use serde_json::json;

    fn bb(x: i32, y: i32, z: i32, w: i32, h: i32, d: i32) -> BoundingBox {
        BoundingBox::new(Vec3Int::new(x, y, z), w, h, d)
    }

    #[test]
    fn bounding_box_set_operations() {
        let a = bb(0, 0, 0, 10, 10, 10);
        let b = bb(5, 5, 5, 10, 10, 10);
        assert!(a.intersects(&b));
        assert_eq!(a.intersection(&b), Some(bb(5, 5, 5, 5, 5, 5)));
        assert_eq!(a.union(&b), bb(0, 0, 0, 15, 15, 15));
        // touching boxes do not intersect
        let c = bb(10, 0, 0, 5, 5, 5);
        assert!(!a.intersects(&c));
        assert_eq!(a.intersection(&c), None);
        assert_eq!(
            BoundingBox::union_all([] as [&BoundingBox; 0]),
            BoundingBox::empty()
        );
        assert_eq!(
            BoundingBox::union_all([&a, &b, &c]),
            bb(0, 0, 0, 15, 15, 15)
        );
        assert_eq!(
            BoundingBox::intersection_all([&a, &b]),
            Some(bb(5, 5, 5, 5, 5, 5))
        );
        assert_eq!(BoundingBox::intersection_all([&a, &b, &c]), None);
        assert!(bb(1, 1, 1, 2, 2, 2).is_fully_contained_in(&a));
        assert!(!b.is_fully_contained_in(&a));
        assert!(bb(0, 0, 0, 0, 1, 1).is_empty());
    }

    #[test]
    fn bounding_box_center_and_mag_scaling() {
        assert_eq!(bb(0, 0, 0, 5, 7, 9).center(), Vec3Int::new(2, 3, 4));
        assert_eq!(bb(-3, 0, 0, 0, 0, 0).center(), Vec3Int::new(-3, 0, 0));
        assert_eq!(bb(-3, 0, 0, 1, 0, 0).center(), Vec3Int::new(-2, 0, 0));
        let mag = Vec3Int::new(2, 2, 1);
        assert_eq!(bb(5, 5, 5, 11, 10, 3).div_mag(mag), bb(2, 2, 5, 6, 5, 3));
        // topLeft uses truncating JVM division, not floor division
        assert_eq!(
            bb(-5, 0, 0, 1, 1, 1).div_mag(mag).top_left,
            Vec3Int::new(-2, 0, 0)
        );
        assert_eq!(bb(1, 2, 3, 4, 5, 6).mul_mag(mag), bb(2, 4, 3, 8, 10, 6));
        assert_eq!(bb(0, 0, 0, 1000, 1000, 1000).volume(), 1_000_000_000);
        assert_eq!(ceil_div(-5, 2), -3);
        assert_eq!(ceil_div(5, 2), 3);
    }

    #[test]
    fn literals() {
        assert_eq!(
            BoundingBox::from_literal(" -1, 2,3 ,4, 5,6 "),
            Some(bb(-1, 2, 3, 4, 5, 6))
        );
        assert_eq!(BoundingBox::from_literal("1,2,3,-4,5,6"), None);
        assert_eq!(BoundingBox::from_literal("1 ,2,3,4,5,6"), None);
        assert_eq!(BoundingBox::from_literal("1,2,3,4,5"), None);
        assert_eq!(BoundingBox::from_literal("1,2,3,4,5,99999999999"), None);
        assert_eq!(bb(1, 2, 3, 4, 5, 6).to_literal(), "1,2,3,4,5,6");
        assert_eq!(
            BoundingBox::from_literal_with_mag_opt("0,0,0,10,10,10", Some("4")),
            Some(bb(0, 0, 0, 3, 3, 3))
        );
        assert_eq!(
            Vec3Int::from_mag_literal("2-2-1", false),
            Some(Vec3Int::new(2, 2, 1))
        );
        assert_eq!(Vec3Int::from_mag_literal("2", false), None);
        assert_eq!(Vec3Int::from_mag_literal("2", true), Some(Vec3Int::full(2)));
        assert_eq!(Vec3Int::from_mag_literal("-2-2-1", true), None);
        assert_eq!(Vec3Int::new(2, 2, 1).to_mag_literal(true), "2-2-1");
        assert_eq!(Vec3Int::full(4).to_mag_literal(true), "4");
        assert_eq!(
            Vec3Int::from_uri_literal("1,2,3"),
            Some(Vec3Int::new(1, 2, 3))
        );
    }

    #[test]
    fn vec_json() {
        assert_eq!(
            Vec3Int::from_json(&json!([1, 2, 3])),
            Ok(Vec3Int::new(1, 2, 3))
        );
        assert_eq!(
            Vec3Int::from_json(&json!([1, 2])),
            Err(JsError::new("validate.error.expected.vec3IntArray"))
        );
        assert_eq!(
            Vec3Int::from_json(&json!([1, 2, "a"])),
            Err(JsError::new("validate.error.array.invalidContent"))
        );
        assert_eq!(Vec3Int::mag_from_json(&json!(4)), Ok(Vec3Int::full(4)));
        assert_eq!(
            serde_json::to_string(&Vec3Double::new(11.24, 11.24, 28.0)).unwrap(),
            "[11.24,11.24,28]"
        );
        assert_eq!(
            serde_json::to_string(&bb(1, 2, 3, 4, 5, 6)).unwrap(),
            r#"{"topLeft":[1,2,3],"width":4,"height":5,"depth":6}"#
        );
        let error = BoundingBox::from_json(&json!({"topLeft": [0, 0], "width": 1})).unwrap_err();
        assert_eq!(
            error.to_play_json(),
            json!({
                "obj.topLeft": [{"msg": ["validate.error.expected.vec3IntArray"], "args": []}],
                "obj.height": [{"msg": ["error.path.missing"], "args": []}],
                "obj.depth": [{"msg": ["error.path.missing"], "args": []}],
            })
        );
        assert!(Vec3Int::new(1, 2, 4).is_all_powers_of_two());
        assert!(!Vec3Int::new(1, 3, 4).is_all_powers_of_two());
        assert_eq!(Vec3Int::new(3, 1, 2).sorted(), Vec3Int::new(1, 2, 3));
    }
