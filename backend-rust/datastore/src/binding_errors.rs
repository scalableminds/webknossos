//! Play 3.0.11 DefaultHttpErrorHandler client errors, distinct from Fox/domain failures.
//!
//! The datastore uses DefaultHttpErrorHandler (HTML for every Accept), not HtmlOrJson.
//! Routing/body-parser failures and JSON schema rejections bypass Action.fox result headers.
use axum::{
    extract::rejection::JsonRejection,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use std::error::Error;
use webknossos_common::text::escape_html;

/// Signals the outer request handler to render the production Play client-error page.
#[derive(Debug, Clone)]
pub struct ClientError {
    pub status: StatusCode,
    pub message: String,
}

/// Signals the controller wrapper to omit Action.fox cache/CORS headers.
#[derive(Debug, Clone, Copy)]
pub struct BypassControllerHeaders;

pub fn mark_bypass(mut response: Response) -> Response {
    response.extensions_mut().insert(BypassControllerHeaders);
    response
}

impl IntoResponse for ClientError {
    fn into_response(self) -> Response {
        let mut response = mark_bypass((self.status, "").into_response());
        response.extensions_mut().insert(self);
        response
    }
}

/// The exact Twirl production badRequest template, independently captured from Scala HTTP.
/// It renders status415/413 under the same Bad Request title via onOtherClientError as well.
pub fn render_client_error(error: ClientError, method: &str, uri: &str) -> Response {
    let detail = format!(
        "For request '{} {}' [{}]",
        escape_html(method),
        escape_html(uri),
        escape_html(&error.message)
    );
    let body = TEMPLATE.replace("{{DETAIL}}", &detail);
    mark_bypass(
        (
            error.status,
            [(header::CONTENT_TYPE, "text/html; charset=UTF-8")],
            body,
        )
            .into_response(),
    )
}

/// Preserve the distinction between a parser failure and a JSON model validation failure.
/// Jackson and serde diagnostics differ; only independently verified diagnostics are translated.
pub fn json_rejection(rejection: JsonRejection) -> Response {
    let status = rejection.status();
    let message = match &rejection {
        JsonRejection::MissingJsonContentType(_) => {
            "Expecting text/json or application/json body".to_owned()
        }
        JsonRejection::JsonSyntaxError(_) => {
            let mut cause: &(dyn Error + 'static) = &rejection;
            let mut diagnostic = None;
            loop {
                if let Some(error) = cause.downcast_ref::<serde_json::Error>() {
                    diagnostic = Some(error.to_string());
                    break;
                }
                match cause.source() {
                    Some(next) => cause = next,
                    None => break,
                }
            }
            let diagnostic = diagnostic.unwrap_or_else(|| rejection.body_text());
            // Jackson diagnostic parity needs an independently verified parser adapter.
            // Preserve the real serde diagnostic rather than special-casing one malformed body.
            format!("Invalid Json: {diagnostic}")
        }
        _ => return mark_bypass(rejection.into_response()),
    };
    ClientError { status, message }.into_response()
}

// Play3.0.11 views.html.defaultpages.badRequest static production HTML.
const TEMPLATE: &str = r##"<!DOCTYPE html>
<html lang="en">
    <head>
        <title>Bad Request</title>
        
<style  type="text/css">
            html, body, pre {
                margin: 0;
                padding: 0;
                font-family: Monaco, 'Lucida Console', monospace;
                background: #ECECEC;
            }
            h1 {
                margin: 0;
                background: #AD632A;
                padding: 20px 45px;
                color: #fff;
                text-shadow: 1px 1px 1px rgba(0,0,0,.3);
                border-bottom: 1px solid #9F5805;
                font-size: 28px;
            }
            p#detail {
                margin: 0;
                padding: 15px 45px;
                background: #F6A960;
                border-top: 4px solid #D29052;
                color: #733512;
                text-shadow: 1px 1px 1px rgba(255,255,255,.3);
                font-size: 14px;
                border-bottom: 1px solid #BA7F5B;
            }
        </style>
    </head>
    <body>
        <h1>Bad Request</h1>

        <p id="detail">
            {{DETAIL}}
        </p>

    </body>
</html>
"##;
