//! HTTP clients. reqwest is built without a TLS crypto provider (`rustls-no-provider`), so the
//! process-wide rustls provider must be installed before the first client is built; without it,
//! building a client fails at runtime. Build every client through [`client_builder`].

use std::sync::Once;

/// Installs ring as the process-wide rustls crypto provider (once; later calls do nothing).
pub fn install_crypto_provider() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        // Fails only if another provider is already installed, which is just as good.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// `reqwest::Client::builder()` after installing the crypto provider.
pub fn client_builder() -> reqwest::ClientBuilder {
    install_crypto_provider();
    reqwest::Client::builder()
}

#[cfg(test)]
mod tests {
    #[test]
    fn builds_a_tls_client() {
        assert!(super::client_builder().build().is_ok());
    }
}
