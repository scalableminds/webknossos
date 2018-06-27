/**
 * error_handling.js
 * @flow
 */
import _ from "lodash";
import AirbrakeClient from "airbrake-js";
import Toast from "libs/toast";
import { location } from "libs/window";
import type { APIUserType } from "admin/api_flow_types";
import messages from "messages";

type ErrorHandlingOptionsType = {
  throwAssertions: boolean,
  sendLocalErrors: boolean,
};

class ErrorWithParams extends Error {
  params: ?mixed;
}

// This method can be used when catching error within async processes.
// For example:
// try {
//   this.setState({ isLoading: true });
// } except (error) {
//   handleGenericError(error);
// } finally {
//   this.setState({isLoading: false});
// }
// When the thrown error is coming from the server, our request module
// will show the error to the user.
// If some other error occurred, this function will tell the user so.
export function handleGenericError(error: { ...Error, messages?: mixed }) {
  if (error.messages) {
    // The user was already notified about this error
    return;
  }
  Toast.error(messages.unknown_error);
  console.warn(error);
}

class ErrorHandling {
  throwAssertions: boolean;
  sendLocalErrors: boolean;
  commitHash: ?string;
  airbrake: AirbrakeClient;

  initialize(options: ErrorHandlingOptionsType) {
    if (options == null) {
      options = { throwAssertions: false, sendLocalErrors: false };
    }
    this.throwAssertions = options.throwAssertions;
    this.sendLocalErrors = options.sendLocalErrors;

    const metaElement = document.querySelector("meta[name='commit-hash']");
    this.commitHash = metaElement ? metaElement.getAttribute("content") : null;

    this.initializeAirbrake();
  }

  initializeAirbrake() {
    // read Airbrake config from DOM
    // config is inject from backend
    const scriptTag = document.querySelector("[data-airbrake-project-id]");
    if (!scriptTag) throw new Error("failed to initialize airbrake");

    const projectId = scriptTag.dataset.airbrakeProjectId;
    const projectKey = scriptTag.dataset.airbrakeProjectKey;
    const envName = scriptTag.dataset.airbrakeEnvironmentName;

    this.airbrake = new AirbrakeClient({
      projectId,
      projectKey,
    });

    this.airbrake.addFilter(notice => {
      notice.context.environment = envName;
      if (this.commitHash != null) {
        notice.context.version = this.commitHash;
      }
      return notice;
    });

    if (!this.sendLocalErrors) {
      this.airbrake.addFilter(
        () => location.hostname !== "127.0.0.1" && location.hostname !== "localhost",
      );
    }

    window.onerror = (message: string, file: string, line: number, colno: number, error: Error) => {
      if (error == null) {
        // older browsers don't deliver the error parameter
        error = new Error(message);
      }
      console.error(error);
      this.airbrake.notify(error);
    };
  }

  notify(error: Error) {
    this.airbrake.notify(error);
  }

  assertExtendContext(additionalContext: Object) {
    this.airbrake.addFilter(notice => {
      Object.assign(notice.context, additionalContext);
      return notice;
    });
  }

  assert = (
    bool: boolean,
    message: string,
    assertionContext?: Object,
    dontThrowError?: boolean = false,
  ) => {
    if (bool) {
      return;
    }

    const error: ErrorWithParams = new ErrorWithParams(`Assertion violated - ${message}`);

    error.params = assertionContext;
    error.stack = this.trimCallstack(error.stack);

    Toast.error(`Assertion violated - ${message}`);

    if (this.throwAssertions && !dontThrowError) {
      // error will be automatically pushed to airbrake due to global handler
      throw error;
    } else {
      console.error(error);
      this.airbrake.notify(error);
    }
  };

  assertExists(variable: any, message: string, assertionContext?: Object) {
    if (variable != null) {
      return;
    }
    this.assert(false, `${message} (variable is ${variable})`, assertionContext);
  }

  assertEquals(actual: any, wanted: any, message: string, assertionContext?: Object) {
    if (actual === wanted) {
      return;
    }
    this.assert(false, `${message} (${actual} != ${wanted})`, assertionContext);
  }

  setCurrentUser(user: APIUserType) {
    this.airbrake.addFilter(notice => {
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

export default new ErrorHandling();
