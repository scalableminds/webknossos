export function getUid(): string {
  if (crypto?.randomUUID != null) {
    return crypto.randomUUID();
  }

  // If randomUUID is not available (e.g., only http instead of https)
  // we fallback to this implementation. Note that this is no a safe
  // in a cryptographic sense and should only be used for non-security
  // purposes.
  function randomDigit() {
    const random = (Math.random() * 16) | 0;
    return random.toString(16);
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = randomDigit();
    // @ts-expect-error & on string relies on JS automatic type coercion
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
