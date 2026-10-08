use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri_plugin_opener::OpenerExt;

const SCOPES: &str =
    "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.readonly";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const KEYRING_SERVICE: &str = "deskpin";
const KEYRING_USER: &str = "google-refresh-token";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// Error string the frontend maps to AuthRequiredError.
pub const AUTH_REQUIRED: &str = "auth_required";

#[derive(Deserialize)]
struct ClientConfig {
    client_id: String,
    client_secret: String,
}

fn client() -> ClientConfig {
    serde_json::from_str(include_str!("../google_client.json"))
        .expect("src-tauri/google_client.json is invalid")
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

/// In-memory access token and the instant it stops being usable.
#[derive(Default)]
pub struct AuthState(Mutex<Option<(String, Instant)>>);

impl AuthState {
    fn cached(&self) -> Option<String> {
        let guard = self.0.lock().unwrap();
        guard.as_ref().filter(|(_, exp)| Instant::now() < *exp).map(|(t, _)| t.clone())
    }

    fn store(&self, token: &TokenResponse) {
        let ttl = Duration::from_secs(token.expires_in.saturating_sub(60));
        *self.0.lock().unwrap() = Some((token.access_token.clone(), Instant::now() + ttl));
    }

    fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

pub fn pkce_pair() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let mut url = url::Url::parse(AUTH_URL).unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", state);
    url.into()
}

/// `None`: not the OAuth callback (e.g. favicon). `Some(Err)`: Google returned an error.
pub fn parse_callback(request_line: &str) -> Option<Result<(String, String), String>> {
    let path = request_line.split_whitespace().nth(1)?;
    let url = url::Url::parse(&format!("http://127.0.0.1{path}")).ok()?;
    let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if let Some(err) = q.get("error") {
        return Some(Err(err.clone()));
    }
    Some(Ok((q.get("code")?.clone(), q.get("state")?.clone())))
}

fn respond(stream: &mut TcpStream, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
}

fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                match parse_callback(request.lines().next().unwrap_or("")) {
                    None => respond(&mut stream, "deskpin is waiting for Google sign-in."),
                    Some(Err(e)) => {
                        respond(&mut stream, "Sign-in cancelled. You can close this tab.");
                        return Err(format!("sign-in failed: {e}"));
                    }
                    Some(Ok((code, state))) if state == expected_state => {
                        respond(&mut stream, "Signed in to deskpin. You can close this tab.");
                        return Ok(code);
                    }
                    Some(Ok(_)) => {
                        respond(&mut stream, "Sign-in failed. Return to deskpin and try again.");
                        return Err("sign-in failed: state mismatch".into());
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("sign-in timed out".into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

async fn token_request(params: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let resp = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    // 400/401 from the token endpoint means the grant is unusable (revoked, expired, bad code).
    if status == reqwest::StatusCode::BAD_REQUEST || status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AUTH_REQUIRED.into());
    }
    resp.error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sign_in(app: tauri::AppHandle, state: tauri::State<'_, AuthState>) -> Result<(), String> {
    let cfg = client();
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let (verifier, challenge) = pkce_pair();
    let (csrf, _) = pkce_pair();

    app.opener()
        .open_url(auth_url(&cfg.client_id, &redirect, &challenge, &csrf), None::<&str>)
        .map_err(|e| e.to_string())?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &csrf))
        .await
        .map_err(|e| e.to_string())??;

    let token = token_request(&[
        ("code", code.as_str()),
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier.as_str()),
    ])
    .await?;
    let refresh = token
        .refresh_token
        .as_deref()
        .ok_or("Google returned no refresh token")?;
    entry()?.set_password(refresh).map_err(|e| e.to_string())?;
    state.store(&token);
    Ok(())
}

#[tauri::command]
pub async fn get_access_token(force: bool, state: tauri::State<'_, AuthState>) -> Result<String, String> {
    if !force {
        if let Some(token) = state.cached() {
            return Ok(token);
        }
    }
    let refresh = match entry()?.get_password() {
        Ok(r) => r,
        Err(keyring::Error::NoEntry) => return Err(AUTH_REQUIRED.into()),
        Err(e) => return Err(e.to_string()),
    };
    let cfg = client();
    match token_request(&[
        ("refresh_token", refresh.as_str()),
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("grant_type", "refresh_token"),
    ])
    .await
    {
        Ok(token) => {
            state.store(&token);
            Ok(token.access_token)
        }
        Err(e) => {
            if e == AUTH_REQUIRED {
                let _ = entry()?.delete_credential();
                state.clear();
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_sha256_of_verifier() {
        let (verifier, challenge) = pkce_pair();
        assert_eq!(verifier.len(), 43);
        assert_eq!(challenge, URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())));
        assert_ne!(pkce_pair().0, verifier);
    }

    #[test]
    fn auth_url_has_required_params() {
        let url = auth_url("cid", "http://127.0.0.1:5000", "chal", "st");
        for p in [
            "client_id=cid",
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A5000",
            "response_type=code",
            "code_challenge=chal",
            "code_challenge_method=S256",
            "access_type=offline",
            "prompt=consent",
            "state=st",
            "auth%2Ftasks",
            "auth%2Fcalendar.readonly",
        ] {
            assert!(url.contains(p), "{p} missing from {url}");
        }
    }

    #[test]
    fn parse_callback_reads_code_and_state() {
        assert_eq!(
            parse_callback("GET /?state=s&code=abc HTTP/1.1"),
            Some(Ok(("abc".to_string(), "s".to_string())))
        );
    }

    #[test]
    fn parse_callback_reports_denial() {
        assert_eq!(
            parse_callback("GET /?error=access_denied&state=s HTTP/1.1"),
            Some(Err("access_denied".to_string()))
        );
    }

    #[test]
    fn parse_callback_ignores_other_requests() {
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1"), None);
    }
}
