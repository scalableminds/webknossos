//! Scala `HttpsDataVault`.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use reqwest::{Client, Method, RequestBuilder, Response, StatusCode, header};

use super::{
    BoxFuture, ByteRange, DataVault, DataVaultCredential, Encoding, RawRead, RemoteUri, UPath,
    VaultError, VaultResult,
};

/// Scala `readTimeout = 10 minutes`.
pub const HTTP_READ_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug)]
pub struct HttpsDataVault {
    credential: Option<DataVaultCredential>,
    client: Client,
    /// Authority of this datastore's public `http.uri` (user tokens are only sent there).
    datastore_authority: Option<String>,
    /// Scala `supportsRangeRequests`.
    supports_range_requests: Mutex<Option<bool>>,
    /// Scala `headerInfoCache` (successful HEAD lookups only).
    header_info_cache: Mutex<HashMap<String, (bool, u64)>>,
}

impl HttpsDataVault {
    /// `client` must not decompress responses (see [`build_http_client`]).
    pub fn new(
        credential: Option<DataVaultCredential>,
        client: Client,
        datastore_uri: &str,
    ) -> Self {
        Self {
            credential,
            client,
            datastore_authority: RemoteUri::parse(datastore_uri)
                .ok()
                .and_then(|u| u.authority().map(str::to_owned)),
            supports_range_requests: Mutex::new(None),
            header_info_cache: Mutex::new(HashMap::new()),
        }
    }

    fn supports_range_requests(&self) -> Option<bool> {
        *self
            .supports_range_requests
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    fn set_supports_range_requests(&self, value: bool) {
        *self
            .supports_range_requests
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(value);
    }

    async fn header_information(&self, uri: &RemoteUri) -> VaultResult<(bool, u64)> {
        if let Some(info) = self
            .header_info_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(uri.as_str())
        {
            return Ok(*info);
        }
        // Scala sends the HEAD request without credentials.
        let response = self
            .client
            .request(Method::HEAD, uri.as_str())
            .timeout(HTTP_READ_TIMEOUT)
            .send()
            .await
            .map_err(VaultError::exception)?;
        let accepts_ranges = response
            .headers()
            .get_all(header::ACCEPT_RANGES)
            .iter()
            .any(|v| v.as_bytes() == b"bytes");
        let size = match response.headers().get(header::CONTENT_LENGTH) {
            None => 0,
            Some(value) => value
                .to_str()
                .ok()
                .and_then(|v| v.parse::<i64>().ok())
                .ok_or_else(|| {
                    VaultError::exception(format!(
                        "java.lang.NumberFormatException: For input string: \"{}\"",
                        String::from_utf8_lossy(value.as_bytes())
                    ))
                })? as u64,
        };
        self.header_info_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(uri.as_str().to_owned(), (accepts_ranges, size));
        Ok((accepts_ranges, size))
    }

    /// Scala `ensureRangeRequestsSupported`.
    async fn ensure_range_requests_supported(&self, uri: &RemoteUri) -> VaultResult<()> {
        let supported = match self.supports_range_requests() {
            Some(supported) => supported,
            None => {
                let (accepts_ranges, _) = self.header_information(uri).await?;
                if accepts_ranges {
                    self.set_supports_range_requests(true);
                }
                // An inconclusive HEAD is checked on the range response instead.
                true
            }
        };
        if supported {
            Ok(())
        } else {
            Err(VaultError::failure(format!(
                "Range requests are not supported for this data vault at {uri}"
            )))
        }
    }

    /// Scala `buildRequest`: user token for this datastore, else basic auth, else X-Auth-Token.
    fn build_request(&self, uri: &RemoteUri, user_token: Option<&str>) -> RequestBuilder {
        let request = self.client.get(uri.as_str()).timeout(HTTP_READ_TIMEOUT);
        if let Some(token) = user_token
            && uri.authority().is_some()
            && uri.authority() == self.datastore_authority.as_deref()
        {
            return request.header("X-Auth-Token", token);
        }
        if let Some((username, password)) = self
            .credential
            .as_ref()
            .and_then(DataVaultCredential::basic_auth)
        {
            return request.basic_auth(username, Some(password));
        }
        if let Some(DataVaultCredential::XAuthToken { token_value, .. }) = &self.credential {
            return request.header("X-Auth-Token", token_value.as_str());
        }
        request
    }

    async fn get(
        &self,
        uri: &RemoteUri,
        range: ByteRange,
        user_token: Option<&str>,
    ) -> VaultResult<Response> {
        let mut request = self.build_request(uri, user_token);
        if let Some(range_header) = range.to_range_header() {
            self.ensure_range_requests_supported(uri).await?;
            request = request.header(header::RANGE, range_header);
        }
        request.send().await.map_err(VaultError::exception)
    }
}

/// HTTP client for vault reads: transfer encodings must reach `VaultPath` untouched (Play WS has
/// compression disabled), redirects are followed like Play WS.
pub fn build_http_client() -> Client {
    Client::builder()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .connect_timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn header_string(response: &Response, name: header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
}

impl DataVault for HttpsDataVault {
    fn read_bytes_encoding_and_range_header<'a>(
        &'a self,
        path: &'a UPath,
        range: ByteRange,
        user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<RawRead>> {
        Box::pin(async move {
            let uri = path.to_remote_uri()?;
            let response = self.get(&uri, range, user_token).await?;
            let content_range = header_string(&response, header::CONTENT_RANGE);
            if !matches!(range, ByteRange::Complete) && self.supports_range_requests().is_none() {
                // Scala `updateRangeRequestsSupportedForResponse`; deviation: only successful
                // responses decide (a 404 must not disable range reads for the whole vault).
                if response.status().is_success() {
                    self.set_supports_range_requests(content_range.is_some());
                }
            }
            let encoding = Encoding::from_rfc7231(
                &header_string(&response, header::CONTENT_ENCODING).unwrap_or_default(),
            )?;
            let status = response.status();
            if status.is_success() {
                if !matches!(range, ByteRange::Complete) && content_range.is_none() {
                    // Deviation: Scala would return the whole object as the "range"; fail instead.
                    return Err(VaultError::failure(format!(
                        "Range requests are not supported for this data vault at {uri}"
                    )));
                }
                let bytes = response.bytes().await.map_err(VaultError::exception)?;
                Ok(RawRead {
                    bytes,
                    encoding,
                    content_range,
                })
            } else if status == StatusCode::NOT_FOUND {
                Err(VaultError::NotFound)
            } else {
                Err(VaultError::failure(format!(
                    "Https read failed for uri {uri}: {} {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("")
                )))
            }
        })
    }

    fn list_directory<'a>(
        &'a self,
        _path: &'a UPath,
        _max_items: usize,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<UPath>>> {
        // HTTP file listing is not supported (Scala returns an empty listing).
        Box::pin(async { Ok(Vec::new()) })
    }

    fn used_storage_bytes<'a>(
        &'a self,
        _path: &'a UPath,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<u64>> {
        // Paid HTTP storage is not supported (Scala returns 0).
        Box::pin(async { Ok(0) })
    }

    fn kind(&self) -> &'static str {
        "HttpsDataVault"
    }
}
