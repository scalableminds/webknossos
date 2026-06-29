export function getUid(): string {
  if (crypto?.randomUUID != null) {
    return crypto.randomUUID();
  }

  // If randomUUID is not available (e.g., only http instead of https)
  // we fallback to this implementation. Note that this is no a safe
  // in a cryptographic sense and should only be used for non-security
  // purposes.
  function randomHexDigit() {
    return (Math.random() * 16) | 0;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    // According to the UUID standard, X needs to be between 0 and f,
    // while y has to be between 8 and b.
    const v = c === "x" ? randomHexDigit() : Math.floor(Math.random() * 4) + 8;
    return v.toString(16);
  });
}
