use super::*;

#[test]
fn renders_counters_and_cumulative_histogram_buckets() {
    let metrics = Metrics::default();
    metrics.observe("GET", "/api/datasets", 200, 0.004);
    metrics.observe("GET", "/api/datasets", 200, 0.2);
    metrics.observe("GET", "/api/datasets", 404, 0.001);
    let text = metrics.render(None, "dev", "abc\"def");
    assert!(text.contains(
        "wk_http_requests_total{method=\"GET\",route=\"/api/datasets\",status=\"200\"} 2"
    ));
    assert!(text.contains(
        "wk_http_requests_total{method=\"GET\",route=\"/api/datasets\",status=\"404\"} 1"
    ));
    let bucket = |le: &str| {
        format!(
            "wk_http_request_duration_seconds_bucket{{method=\"GET\",route=\"/api/datasets\",status=\"200\",le=\"{le}\"}}"
        )
    };
    assert!(text.contains(&format!("{} 0", bucket("0.0025"))));
    assert!(text.contains(&format!("{} 1", bucket("0.005"))));
    assert!(text.contains(&format!("{} 2", bucket("0.25"))));
    assert!(text.contains(&format!("{} 2", bucket("+Inf"))));
    assert!(text.contains("wk_build_info{version=\"dev\",commit=\"abc\\\"def\"} 1"));
}
