    use super::*;

    fn temp() -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "wk-dataset-files-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn trash_moves_are_deduplicated() {
        let orga = temp();
        for _ in 0..3 {
            std::fs::create_dir_all(orga.join("ds/color")).unwrap();
            std::fs::write(orga.join("ds/color/x"), b"1").unwrap();
            move_to_trash("id", &orga.join("ds"), "ds", Some("test")).unwrap();
        }
        assert!(!orga.join("ds").exists());
        assert!(orga.join(".trash/ds/color/x").exists());
        assert!(orga.join(".trash/ds (1)/color/x").exists());
        assert!(orga.join(".trash/ds (2)/color/x").exists());
        // Missing datasets are skipped successfully.
        move_to_trash("id", &orga.join("missing"), "missing", None).unwrap();
    }

    #[test]
    fn recursive_delete_refuses_files_and_unlinks_symlinks() {
        let dir = temp();
        std::fs::create_dir_all(dir.join("target/sub")).unwrap();
        std::fs::write(dir.join("file"), b"x").unwrap();
        let error = delete_directory_recursively(&dir.join("file")).unwrap_err();
        assert!(error.message.starts_with("Failed to delete directory "));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("target"), dir.join("link")).unwrap();
            delete_directory_recursively(&dir.join("link")).unwrap();
            assert!(dir.join("target/sub").exists());
        }
        delete_directory_recursively(&dir.join("target")).unwrap();
        assert!(!dir.join("target").exists());
        delete_directory_recursively(&dir.join("missing")).unwrap();
    }
