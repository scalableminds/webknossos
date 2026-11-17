//! Conversions between Java and Rust values and the error handling shared by all native functions.

use std::any::Any;
use std::fmt;
use std::panic::{self, AssertUnwindSafe};

use jni::errors::ThrowRuntimeExAndDefault;
use jni::objects::{JByteArray, JIntArray, JLongArray};
use jni::{Env, EnvUnowned};

/// An error of a native function. It reaches Java as a `RuntimeException`.
#[derive(Debug)]
pub enum NativeError {
    InvalidArgument(String),
    Jni(jni::errors::Error),
    Panic(String),
}

pub type NativeResult<T> = Result<T, NativeError>;

pub fn invalid_argument<T>(message: impl Into<String>) -> NativeResult<T> {
    Err(NativeError::InvalidArgument(message.into()))
}

impl fmt::Display for NativeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NativeError::InvalidArgument(message) => f.write_str(message),
            NativeError::Jni(error) => write!(f, "JNI error: {error}"),
            NativeError::Panic(message) => write!(f, "Rust panic: {message}"),
        }
    }
}

impl std::error::Error for NativeError {}

impl From<jni::errors::Error> for NativeError {
    fn from(error: jni::errors::Error) -> Self {
        NativeError::Jni(error)
    }
}

/// A [NativeError] together with the native function it occurred in.
#[derive(Debug)]
pub struct ContextError {
    context: &'static str,
    error: NativeError,
}

impl fmt::Display for ContextError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Native Exception in {}: {}", self.context, self.error)
    }
}

impl std::error::Error for ContextError {}

impl From<jni::errors::Error> for ContextError {
    fn from(error: jni::errors::Error) -> Self {
        ContextError {
            context: "JNI",
            error: NativeError::Jni(error),
        }
    }
}

/// The message of a panic payload. `panic!` with a literal yields a `&'static str`, with format arguments a
/// `String`.
fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&'static str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "non-string panic payload".to_string()
    }
}

/// Runs the body of a native function. An error or a panic is thrown to Java as a `RuntimeException` whose
/// message names `context`, and the function then returns `T::default()`, which Java ignores.
///
/// Panics are caught here rather than left to jni's `with_env`, whose handler only keeps `&'static str` payloads
/// and drops `context`.
pub fn run<'local, T: Default>(
    mut env: EnvUnowned<'local>,
    context: &'static str,
    body: impl FnOnce(&mut Env<'local>) -> NativeResult<T>,
) -> T {
    env.with_env(|env| {
        // The body's state is discarded after a panic, so observing it half-updated is not a concern.
        panic::catch_unwind(AssertUnwindSafe(|| body(env)))
            .unwrap_or_else(|payload| Err(NativeError::Panic(panic_message(&*payload))))
            .map_err(|error| ContextError { context, error })
    })
    .resolve::<ThrowRuntimeExAndDefault>()
}

/// Copies a Java `byte[]` into a Vec.
pub fn read_bytes(env: &Env, array: &JByteArray) -> NativeResult<Vec<u8>> {
    Ok(env.convert_byte_array(array)?)
}

/// Copies a Java `long[]` into a Vec.
pub fn read_longs(env: &Env, array: &JLongArray) -> NativeResult<Vec<i64>> {
    let mut values = vec![0i64; array.len(env)?];
    array.get_region(env, 0, &mut values)?;
    Ok(values)
}

/// Creates a new Java `byte[]` with the given contents.
pub fn new_byte_array<'local>(
    env: &mut Env<'local>,
    values: &[u8],
) -> NativeResult<JByteArray<'local>> {
    Ok(env.byte_array_from_slice(values)?)
}

/// Overwrites the contents of an existing Java `byte[]`, which must have exactly `values.len()` elements.
pub fn write_bytes(env: &Env, array: &JByteArray, values: &[u8]) -> NativeResult<()> {
    // u8 and i8 (jbyte) have the same size and alignment, so the slice can be reinterpreted.
    let signed = unsafe { std::slice::from_raw_parts(values.as_ptr().cast::<i8>(), values.len()) };
    Ok(array.set_region(env, 0, signed)?)
}

/// Creates a new Java `long[]` with the given contents.
pub fn new_long_array<'local>(
    env: &mut Env<'local>,
    values: &[i64],
) -> NativeResult<JLongArray<'local>> {
    let array = env.new_long_array(values.len())?;
    array.set_region(env, 0, values)?;
    Ok(array)
}

/// Creates a new Java `int[]` with the given contents.
pub fn new_int_array<'local>(
    env: &mut Env<'local>,
    values: &[i32],
) -> NativeResult<JIntArray<'local>> {
    let array = env.new_int_array(values.len())?;
    array.set_region(env, 0, values)?;
    Ok(array)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_message_of_formatted_and_literal_panics() {
        let index = 7;
        let formatted = panic::catch_unwind(|| panic!("index {index} out of bounds")).unwrap_err();
        assert_eq!(panic_message(&*formatted), "index 7 out of bounds");
        let literal = panic::catch_unwind(|| panic!("literal")).unwrap_err();
        assert_eq!(panic_message(&*literal), "literal");
        let other = panic::catch_unwind(|| std::panic::panic_any(42)).unwrap_err();
        assert_eq!(panic_message(&*other), "non-string panic payload");
    }
}
