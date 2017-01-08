import _ from "lodash";
import Deferred from "./deferred";


class Pipeline {

  // Executes asnychronous actions in order.
  //
  // Each action is executed after the previous action
  // is finished. Any output of the previous action is
  // passed to the current action.


  constructor(firstArguments, options = {}) {
    this.options = options;
    this.actions = [];
    this.nextArguments = firstArguments;
    this.retryCount = 0;
    this.running = false;
    this.failed = false;
    this.executeNext = this.executeNext.bind(this);

    _.defaults(this.options, {
      maxRetry: 3,
      retryTimeMs: 1000,
    },
    );
  }


  isBusy() {
    return this.actions.length !== 0;
  }


  getLastActionPromise() {
    if (this.actions.length === 0) {
      return Promise.resolve();
    }

    return this.actions[this.actions.length - 1].deferred.promise();
  }


  executeAction(action) {
    // action : function that returns a `Promise`

    action.deferred = new Deferred();
    this.actions.push(action);

    if (!this.running) {
      this.executeNext();
    }

    return action.deferred.promise();
  }


  executePassAlongAction(action) {
    // For actions that don't return anything

    const newAction = function () {
      const args = arguments;
      return action(...args).then(() =>
        // TODO: Figure out how to pass along all arguments
        args[0]);
    };

    return this.executeAction(newAction);
  }


  executeActions(actionList) {
    let promise;
    for (const action of actionList) {
      promise = this.executeAction(action);
    }
    return promise;
  }


  restart() {
    // To restart the pipeline after it failed.
    // Returns a new Promise for the first item.

    if (this.failed && this.actions.length > 0) {
      this.failed = false;
      this.retryCount = 0;
      this.running = false;

      // Reinsert first action
      return this.executeAction(this.actions.shift());
    }

    return Promise.resolve();
  }


  executeNext() {
    const currentAction = this.actions.shift();

    if (currentAction != null) {
      this.running = true;

      return currentAction(...this.nextArguments).then(
        function (response) {
          currentAction.deferred.resolve(response);

          this.nextArguments = arguments;
          this.retryCount = 0;
          return this.executeNext();
        }.bind(this),

        (response) => {
          this.retryCount++;
          this.actions.unshift(currentAction);

          if (this.retryCount >= this.options.maxRetry) {
            this.failed = true;
            return currentAction.deferred.reject(response);
          } else {
            return setTimeout(this.executeNext, this.options.retryTimeMs);
          }
        },
      );
    } else {
      return this.running = false;
    }
  }
}

export default Pipeline;
