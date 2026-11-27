use super::*;

#[test]
fn instants_accept_scala_inputs() {
    assert_eq!(
        parse_instant(&json!(1500)).unwrap().timestamp_millis(),
        1500
    );
    assert_eq!(
        parse_instant(&json!("1500")).unwrap().timestamp_millis(),
        1500
    );
    assert_eq!(
        parse_instant(&json!("1970-01-01T00:00:01.5Z"))
            .unwrap()
            .timestamp_millis(),
        1500
    );
    assert!(parse_instant(&json!(1.5)).is_none());
    assert!(parse_instant(&json!(null)).is_none());
}

#[test]
fn events_are_grouped_and_validated() {
    let grouped = parse_events(vec![
        json!({"type": "RUN_HEARTBEAT", "timestamp": 1}),
        json!({"type": "RUN_STATE_CHANGE", "state": "RUNNING", "timestamp": "2"}),
    ])
    .unwrap();
    assert_eq!(grouped.heartbeats.len(), 1);
    assert_eq!(grouped.run_states[0].state, "RUNNING");
    for invalid in [
        json!({"timestamp": 1}),
        json!({"type": "OTHER"}),
        json!({"type": "RUN_STATE_CHANGE", "state": "running", "timestamp": 1}),
    ] {
        assert!(parse_events(vec![invalid]).is_err());
    }
}

#[test]
fn state_times_follow_the_event_state() {
    let t = DateTime::from_timestamp_millis(1000).unwrap();
    assert_eq!(
        state_times("RUNNING", t),
        (json!("1970-01-01T00:00:01.000Z"), Value::Null)
    );
    assert_eq!(
        state_times("FAILED", t),
        (Value::Null, json!("1970-01-01T00:00:01.000Z"))
    );
    assert_eq!(state_times("SKIPPED", t), (Value::Null, Value::Null));
}

#[test]
fn report_entries_omit_absent_options_and_link_foreign_workflows() {
    let id = ObjectId::parse("0123456789abcdef01234567").unwrap();
    let artifact = voxelytics_dao::ArtifactEntry {
        artifact_id: id.clone(),
        task_id: id.clone(),
        name: "out".into(),
        path: "/out".into(),
        file_size: 1,
        inode_count: 2,
        version: "1".into(),
        metadata: json!({}),
        task_name: "t".into(),
        foreign_workflow: Some(("other".into(), id.clone())),
    };
    assert_eq!(
        serde_json::to_value(&artifact).unwrap(),
        json!({
            "artifactId": id, "taskId": id, "name": "out", "path": "/out", "fileSize": 1,
            "inodeCount": 2, "version": "1", "metadata": {}, "taskName": "t",
            "foreignWorkflow": ["other", id]
        })
    );
    let run = voxelytics_dao::RunEntry {
        id: id.clone(),
        name: "r".into(),
        host_user_name: "u".into(),
        host_name: "h".into(),
        voxelytics_version: "1".into(),
        workflow_hash: "w".into(),
        workflow_yaml_content: None,
        workflow_config: json!({}),
        state: "PENDING".into(),
        begin_time: None,
        end_time: None,
    };
    assert_eq!(
        serde_json::to_value(&run).unwrap(),
        json!({
            "id": id, "name": "r", "hostUserName": "u", "hostName": "h", "voxelyticsVersion": "1",
            "workflowHash": "w", "workflowYamlContent": null, "workflowConfig": {}, "state": "PENDING"
        })
    );
}
