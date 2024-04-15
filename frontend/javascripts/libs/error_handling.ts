import { Notifier } from "@airbrake/browser";
import _ from "lodash";
import { getActionLog } from "oxalis/model/helpers/action_logger_middleware";
import type { APIUser } from "types/api_flow_types";
import Toast from "libs/toast";
import messages from "messages";
import window, { document, location } from "libs/window";
// Note that if you set this value to true for debugging airbrake reporting,
// you also need to set the values for projectID and projectKey in application.conf
const LOG_LOCAL_ERRORS = false;
const UNHANDLED_REJECTION_LABEL = "UnhandledRejection";
const UNHANDLED_REJECTION_PREFIX = `${UNHANDLED_REJECTION_LABEL}: `;
// No more than MAX_NUM_ERRORS will be reported to airbrake
const MAX_NUM_ERRORS = 50;
const BLACKLISTED_ERROR_MESSAGES = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications.",
  "Invariant Violation: Cannot call hover while not dragging.", // Errors from the sortable-tree when dragging an element onto itself
  "Uncaught Invariant Violation: Expected to find a valid target.",
  "Uncaught TypeError: Cannot read property 'path' of null",
];
type ErrorHandlingOptions = {
  throwAssertions: boolean;
};

class ErrorWithParams extends Error {
  params: unknown | null | undefined;
} // This method can be used when catching error within async processes.
// For example:
// try {
//   this.setState({ isLoading: true });
// } except (error) {
//   handleGenericError(error as Error);
// } finally {
//   this.setState({isLoading: false});
// }
// When the thrown error is coming from the server, our request module
// will show the error to the user.
// If some other error occurred, this function will tell the user so.

export function handleGenericError(
  error: Error & {
    messages?: unknown;
  },
  fallbackMessage?: string | null,
) {
  if (error.messages) {
    // The user was already notified about this error
    return;
  }

  Toast.error(fallbackMessage || messages.unknown_error);
  console.warn(error);
}

class ErrorHandling {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'throwAssertions' has no initializer and ... Remove this comment to see the full error message
  throwAssertions: boolean;
  commitHash: string | null | undefined;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'airbrake' has no initializer and is not ... Remove this comment to see the full error message
  airbrake: Notifier;
  numberOfErrors: number = 0;
  sessionStartTime: Date = new Date();

  initialize(options: ErrorHandlingOptions) {
    if (options == null) {
      options = {
        throwAssertions: false,
      };
    }

    this.throwAssertions = options.throwAssertions;
    const metaElement = document.querySelector("meta[name='commit-hash']");
    this.commitHash = metaElement ? metaElement.getAttribute("content") : null;
    this.initializeAirbrake();
  }

  initializeAirbrake() {
    // read Airbrake config from DOM
    // config is inject from backend
    const scriptTag = document.querySelector("[data-airbrake-project-id]");
    if (!scriptTag) throw new Error("failed to initialize airbrake");
    // @ts-ignore
    const { dataset } = scriptTag;
    const projectId = dataset.airbrakeProjectId;
    const projectKey = dataset.airbrakeProjectKey;
    const envName = dataset.airbrakeEnvironmentName;
    this.airbrake = new Notifier({
      projectId,
      projectKey,
      remoteConfig: false,
    });
    this.airbrake.addFilter((notice) => {
      notice.context = notice.context || {};
      notice.context.environment = envName;

      if (this.commitHash != null) {
        notice.context.version = this.commitHash;
      }

      return notice;
    });
    // Do not report more than MAX_NUM_ERRORS to airbrake
    this.airbrake.addFilter((notice) => {
      this.numberOfErrors++;

      if (this.numberOfErrors <= MAX_NUM_ERRORS) {
        return notice;
      }

      return null;
    });
    this.airbrake.addFilter((notice) => {
      if (
        LOG_LOCAL_ERRORS ||
        (location.hostname !== "127.0.0.1" && location.hostname !== "localhost")
      ) {
        return notice;
      }

      return null;
    });
    // Remove airbrake's unhandledrejection handler
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeEventListener' does not exist on t... Remove this comment to see the full error message
    window.removeEventListener("unhandledrejection", this.airbrake.onUnhandledrejection);
    window.addEventListener("unhandledrejection", (event) => {
      // Create our own error for unhandled rejections here to get additional information for [Object object] errors in airbrake
      const reasonAsString = event.reason instanceof Error ? event.reason.toString() : event.reason;
      let wrappedError = event.reason instanceof Error ? event.reason : new Error(event.reason);
      wrappedError = {
        ...wrappedError,
        // The message property is read-only in newer browser versions which is why
        // the object is copied shallowly.
        message: UNHANDLED_REJECTION_PREFIX + JSON.stringify(reasonAsString).slice(0, 80),
      };

      this.notify(wrappedError, {
        originalError: reasonAsString,
      });
    });

    // Report Content Security Policy (CSP) errors
    document.addEventListener("securitypolicyviolation", (e: SecurityPolicyViolationEvent) => {
      const additionalProperties = _.pick(e, [
        "blockedURI",
        "violatedDirective",
        "originalPolicy",
        "documentURI",
        "sourceFile",
        "lineNumber",
        "columnNumber",
      ]);
      this.notify(
        new Error(`Content Security Policy Violation while loading ${e.blockedURI}.`),
        additionalProperties,
      );
    });

    window.onerror = (
      message: Event | string,
      _file?: string,
      _line?: number,
      _colno?: number,
      error?: Error,
    ) => {
      message = message.toString();
      if (BLACKLISTED_ERROR_MESSAGES.indexOf(message) > -1) {
        console.warn("Ignoring", message);
        return;
      }

      if (error == null) {
        // Older browsers (and apparently Safari) don't deliver the error parameter
        error = new Error(message);
      }

      this.notify(error);

      if (error.toString() === "Error: Script error.") {
        // Safari and the newest antd version don't play well together. Often, "ResizeObserver loop completed with undelivered notifications." is triggered
        // but that message is lost. Instead, a "Script error." is thrown. Since that error is benign and can be frequent, we will
        // ignore it here to not annoy the user. The message wasn't added to BLACKLISTED_ERROR_MESSAGES so that the error can still be seen via airbrake.
        // Unfortunately, this workaround can mean that we won't show error toasts about other "real" errors.
        // Follow-up: https://github.com/scalableminds/webknossos/issues/5372
        return;
      }

      Toast.error(
        `An unknown error occurred. Please consider refreshing this page to avoid an inconsistent state. Error message: ${error.toString()}`,
      );
    };
  }

  notify(
    maybeError: Record<string, any> | Error,
    optParams: Record<string, any> = {},
    severity: "error" | "warning" = "error",
  ) {
    if (process.env.IS_TESTING) {
      return;
    }

    const actionLog = getActionLog();
    const error = maybeError instanceof Error ? maybeError : new Error(JSON.stringify(maybeError));
    this.airbrake.notify({
      error,
      params: { ...optParams, actionLog, sessionStartTime: this.sessionStartTime },
      context: { severity },
    });
  }

  assertExtendContext(additionalContext: Record<string, any>) {
    this.airbrake.addFilter((notice) => {
      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'error' implicitly has an 'any' type.
      notice.errors.forEach((error) => {
        const index = error.message.indexOf(UNHANDLED_REJECTION_PREFIX);

        if (index > -1) {
          error.type = UNHANDLED_REJECTION_LABEL;
        }
      });
      Object.assign(notice.context, additionalContext);
      return notice;
    });
  }

  assert(
    bool: boolean,
    message: string,
    assertionContext?: Record<string, any>,
    dontThrowError: boolean = false,
  ): asserts bool is true {
    if (bool) {
      return;
    }

    const error: ErrorWithParams = new ErrorWithParams(`Assertion violated - ${message}`);
    error.params = assertionContext;
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
    error.stack = this.trimCallstack(error.stack);
    Toast.error(`Assertion violated - ${message}`);

    if (this.throwAssertions && !dontThrowError) {
      // error will be automatically pushed to airbrake due to global handler
      throw error;
    } else {
      console.error(error);
      this.airbrake.notify(error);
    }
  }

  assertExists<T>(
    variable: T | null,
    message: string,
    assertionContext?: Record<string, any>,
  ): asserts variable is NonNullable<T> {
    if (variable != null) {
      return;
    }

    this.assert(false, `${message} (variable is ${variable})`, assertionContext);
  }

  assertEquals(actual: any, wanted: any, message: string, assertionContext?: Record<string, any>) {
    if (actual === wanted) {
      return;
    }

    this.assert(false, `${message} (${actual} != ${wanted})`, assertionContext);
  }

  setCurrentUser(user: APIUser) {
    this.airbrake.addFilter((notice) => {
      notice.context = notice.context || {};
      notice.context.user = _.pick(user, ["id", "email", "firstName", "lastName", "isActive"]);
      return notice;
    });
  }

  trimCallstack(callstack: string) {
    // cut function calls caused by ErrorHandling so that Airbrake won't cluster all assertions into one group
    const trimmedCallstack = [];

    for (const line of callstack.split("\n")) {
      if (line.indexOf("errorHandling.js") === -1) {
        trimmedCallstack.push(line);
      }
    }

    return trimmedCallstack.join("\n");
  }
}

const errorHandling: ErrorHandling = new ErrorHandling();

export default errorHandling;
