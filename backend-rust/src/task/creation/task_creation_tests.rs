use super::*;
use crate::proto::Vec3IntProto;
use webknossos_common::geometry::Vec3Int;

#[test]
fn java_double_literals() {
    assert_eq!(java_double(0.0), "0.0");
    assert_eq!(java_double(-0.0), "-0.0");
    assert_eq!(java_double(90.0), "90.0");
    assert_eq!(java_double(1.5), "1.5");
    assert_eq!(java_double(1e7), "1.0E7");
    assert_eq!(java_double(1.25e-5), "1.25E-5");
    assert_eq!(vec3_double_literal([0.0, 12.5, 360.0]), "0.0,12.5,360.0");
    assert_eq!(
        BoundingBox::new(Vec3Int::new(1, -2, 3), 4, 5, 6).to_literal(),
        "1,-2,3,4,5,6"
    );
}

#[test]
fn task_parameters_follow_play_format() {
    let body = json!({
        "taskTypeId": "5a5f2f4d2b00002b00b4b2a1", "neededExperience": {"domain": "d", "value": 1},
        "pendingInstances": 2, "projectName": "p", "datasetId": "5a5f2f4d2b00002b00b4b2a2",
        "editPosition": [1, 2, 3], "editRotation": [0, 0.5, 1], "scriptId": null,
        "baseAnnotation": {"baseId": "x"}
    });
    let params: TaskParameters = serde_json::from_value(body.clone()).unwrap();
    assert_eq!(params.base_annotation.unwrap().skeleton_id, None);
    assert_eq!(params.edit_rotation, [0.0, 0.5, 1.0]);
    let mut missing = body;
    missing.as_object_mut().unwrap().remove("editPosition");
    assert!(serde_json::from_value::<TaskParameters>(missing).is_err());
}

#[test]
fn batch_limit_and_ids_follow_tracing_type() {
    let mut task_type = TaskTypeFacts {
        id: ObjectId::new(),
        tracing_type: TracingType::Skeleton,
        mag_restrictions: MagRestrictions::default(),
    };
    assert!(assert_batch_limit(1000, &task_type).is_ok());
    assert!(assert_batch_limit(1001, &task_type).is_err());
    task_type.tracing_type = TracingType::Hybrid;
    let error = assert_batch_limit(101, &task_type).unwrap_err();
    assert_eq!(
        error.message,
        "Cannot create more than 100 tasks in one request."
    );
    let mut params: TaskParameters = serde_json::from_value(json!({
        "taskTypeId": "5a5f2f4d2b00002b00b4b2a1", "neededExperience": {"domain": "d", "value": 1},
        "pendingInstances": 2, "projectName": "p", "datasetId": "5a5f2f4d2b00002b00b4b2a2",
        "editPosition": [1, 2, 3], "editRotation": [0, 0, 0]
    }))
    .unwrap();
    add_new_ids(&mut params, &task_type);
    assert!(params.new_skeleton_tracing_id.is_some() && params.new_volume_tracing_id.is_some());
    task_type.tracing_type = TracingType::Volume;
    add_new_ids(&mut params, &task_type);
    assert!(params.new_skeleton_tracing_id.is_none() && params.new_volume_tracing_id.is_some());
}

#[test]
fn skeleton_base_has_one_node_tree() {
    let empty = BoundingBox::new(Vec3Int::zeros(), 0, 1, 1);
    let tracing = skeleton_tracing_base(Some(empty), [1, 2, 3], [0.0, 90.0, 0.0]);
    assert_eq!(tracing.bounding_box, None);
    assert_eq!(tracing.dataset_name, "unused");
    assert_eq!(tracing.active_node_id, Some(1));
    assert_eq!(tracing.trees.len(), 1);
    let tree = &tracing.trees[0];
    assert_eq!(
        (tree.tree_id, tree.nodes.len(), tree.nodes[0].id),
        (1, 1, 1)
    );
    assert_eq!(tree.nodes[0].position, Vec3IntProto { x: 1, y: 2, z: 3 });
    assert_eq!(tree.branch_points[0].node_id, 1);
    assert_eq!(tree.color.unwrap().r, 1.0);
}
