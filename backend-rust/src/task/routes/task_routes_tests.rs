use super::*;
#[test]
fn update_requires_scala_task_parameters() {
    assert!(serde_json::from_value::<TaskParameters>(json!({"pendingInstances":2})).is_err());
    let body = json!({"pendingInstances":2,"taskTypeId":"000000000000000000000001","neededExperience":{"domain":"test","value":1},"projectName":"project","datasetId":"000000000000000000000002","editPosition":[1,2,3],"editRotation":[0,0,0]});
    assert!(serde_json::from_value::<TaskParameters>(body.clone()).is_ok());
    let mut invalid = body;
    invalid["editPosition"] = json!([1, 2]);
    assert!(serde_json::from_value::<TaskParameters>(invalid).is_err());
}
