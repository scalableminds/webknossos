// A worker-safe assertion helper.
//
// `libs/error_handling` reports violated assertions via a toast and to Airbrake, but it pulls in
// antd (through libs/toast) and @airbrake/browser. Modules that also run inside web workers — the
// dataset and flycam accessors, for instance — must therefore not import it statically, or every
// worker bundle grows by ~300 kB of react-dom and antd. Those modules import this module instead.
//
// On the main thread `libs/error_handling` installs the real reporter as soon as it is loaded
// (main.tsx imports it during startup, long before any accessor runs). Inside a worker nothing
// installs one, so a violation is logged to the console instead.

type AssertionReporter = (message: string, assertionContext?: Record<string, any>) => void;

let reportViolation: AssertionReporter = (message, assertionContext) => {
  console.warn(`Assertion violated - ${message}`, assertionContext);
};

export function setAssertionReporter(reporter: AssertionReporter): void {
  reportViolation = reporter;
}

export function assert(
  bool: boolean,
  message: string,
  assertionContext?: Record<string, any>,
): asserts bool is true {
  if (bool) {
    return;
  }

  reportViolation(message, assertionContext);
}
