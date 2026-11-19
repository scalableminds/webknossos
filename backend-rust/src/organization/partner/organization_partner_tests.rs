use super::*;

fn parse(body: &str) -> Result<OrganizationPartnerParameters, serde_json::Error> {
    serde_json::from_str(body)
}

#[test]
fn partner_id_is_optional_and_null_removes_the_partner() {
    assert_eq!(
        parse(r#"{"partnerId": "68F0C0FFEE0000000000000A"}"#)
            .unwrap()
            .partner_id
            .as_ref()
            .map(ObjectId::as_str),
        Some("68f0c0ffee0000000000000a")
    );
    assert!(
        parse(r#"{"partnerId": null}"#)
            .unwrap()
            .partner_id
            .is_none()
    );
    assert!(parse("{}").unwrap().partner_id.is_none());
}

#[test]
fn partner_id_must_be_an_object_id() {
    assert!(parse(r#"{"partnerId": "partner"}"#).is_err());
    assert!(parse(r#"{"partnerId": 5}"#).is_err());
}
