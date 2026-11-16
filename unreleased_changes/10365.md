### Changed
- Streaming datasets from Google Cloud Storage is much faster: each read is now a single non-blocking ranged request instead of two blocking ones.
