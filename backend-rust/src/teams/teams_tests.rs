use super::*;
#[test]
fn team_names_follow_database_character_contract() {
    assert!("A team-1_ß. ".chars().all(valid_name_character));
    for invalid in ['é', '/', '\n', '\t', '💡'] {
        assert!(!valid_name_character(invalid));
    }
}
