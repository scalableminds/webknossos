/**
 * error_handling.js
 * @flow weak
 */
import _ from "lodash";
import $ from "jquery";
import AirbrakeClient from "airbrake-js";
import Toast from "libs/toast";

class ErrorWithParams extends Error {
  params: ?mixed;
}

class ErrorHandling {
  throwAssertions: boolean;
  sendLocalErrors: boolean;
  commitHash: ?string;
  airbrake: AirbrakeClient;

  initialize(options) {
    if (options == null) {
      options = { throwAssertions: false, sendLocalErrors: false };
    }
    this.throwAssertions = options.throwAssertions;
    this.sendLocalErrors = options.sendLocalErrors;

    this.commitHash = $("meta[name='commit-hash']").attr("content");

    this.initializeAirbrake();
  }

  initializeAirbrake() {
    // read Airbrake config from DOM
    // config is inject from backend
    const $scriptTag = $("[data-airbrake-project-id]");
    const projectId = $scriptTag.data("airbrake-project-id");
    const projectKey = $scriptTag.data("airbrake-project-key");
    const envName = $scriptTag.data("airbrake-environment-name");

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

    window.onerror = (message, file, line, colno, error) => {
      if (error == null) {
        // older browsers don't deliver the error parameter
        // $FlowFixMe
        error = new Error(message, file, line);
      }
      console.error(error);
      this.airbrake.notify(error);
    };
  }

  notify(error: Error) {
    this.airbrake.notify(error);
  }

  assertExtendContext(additionalContext) {
    this.airbrake.addFilter(notice => {
      Object.assign(notice.context, additionalContext);
      return notice;
    });
  }

  assert = (bool, message, assertionContext, dontThrowError) => {
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

  assertExists(variable, message, assertionContext) {
    if (variable != null) {
      return;
    }
    this.assert(false, `${message} (variable is ${variable})`, assertionContext);
  }

  assertEquals(actual, wanted, message, assertionContext) {
    if (actual === wanted) {
      return;
    }
    this.assert(false, `${message} (${actual} != ${wanted})`, assertionContext);
  }

  setCurrentUser(user) {
    this.airbrake.addFilter(notice => {
      notice.context.user = _.pick(user, ["id", "email", "firstName", "lastName", "isActive"]);
      return notice;
    });
  }

  trimCallstack(callstack) {
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
