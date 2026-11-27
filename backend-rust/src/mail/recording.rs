//! In-memory mailer for tests and local inspection.
use std::sync::{Arc, Mutex};

use super::{Mail, Mailer};

/// In-memory mailer for tests and local inspection.
#[derive(Clone, Default)]
pub struct RecordingMailer(Arc<Mutex<Vec<Mail>>>);

impl RecordingMailer {
    pub fn messages(&self) -> Vec<Mail> {
        self.0.lock().map(|m| m.clone()).unwrap_or_default()
    }

    pub fn take(&self) -> Vec<Mail> {
        self.0
            .lock()
            .map(|mut m| std::mem::take(&mut *m))
            .unwrap_or_default()
    }
}

impl Mailer for RecordingMailer {
    fn send(&self, mail: Mail) {
        if let Ok(mut messages) = self.0.lock() {
            messages.push(mail);
        }
    }
}
