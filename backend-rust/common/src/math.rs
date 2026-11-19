/// MathUtils.ceilDiv with JVM Int overflow semantics (never panics): rounds the
/// magnitude up, then applies the sign.
pub fn ceil_div(num: i32, divisor: i32) -> i32 {
    let sign = num.signum() * divisor.signum();
    sign.wrapping_mul(
        num.wrapping_abs()
            .wrapping_add(divisor.wrapping_abs())
            .wrapping_sub(1),
    )
    .wrapping_div(divisor.wrapping_abs())
}

#[cfg(test)]
mod math_tests;
