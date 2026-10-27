use super::*;
use serde_json::json;

#[test]
fn priority_classes_partition_the_commands() {
    let high = commands(true, None);
    let low = commands(false, None);
    assert_eq!(high, vec!["convert_to_wkw", "export_tiff"]);
    assert_eq!(high.len() + low.len(), JOB_COMMANDS.len());
    assert!(low.contains(&"infer_nuclei".to_owned()));
}

#[test]
fn job_states_map_to_their_names() {
    assert_eq!(JobState::PENDING.as_str(), "PENDING");
    assert_eq!(JobState::CANCELLED.as_str(), "CANCELLED");
    let status: JobStatus = serde_json::from_value(json!({
        "state": "SUCCESS", "started": 1000, "ended": "1970-01-01T00:00:02Z",
        "latestRunId": null, "errorDetails": {"message": "x"}
    }))
    .unwrap();
    assert!(status.state == JobState::SUCCESS);
    assert_eq!(status.started.unwrap().timestamp_millis(), 1000);
    assert_eq!(status.ended.unwrap().timestamp_millis(), 2000);
    assert!(serde_json::from_value::<JobStatus>(json!({"state": "DONE"})).is_err());
    assert!(
        serde_json::from_value::<JobStatus>(json!({"state": "FAILURE", "errorDetails": 1}))
            .is_err()
    );
}
