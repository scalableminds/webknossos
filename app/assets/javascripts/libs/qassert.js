/**
 * @fileOverview QAssert - A JavaScript Assertions Framework with AJAX reporting.
 * @see <a href="https://github.com/gaboom/qassert">Project Homepage</a>
 *
 * @author Copyright (c) 2011 EPAM Systems - Dual licensed under the MIT or GPL licenses.
 * @author Gábor Czigola
 * @version 0.3
 * @requires jQuery
 */

/** jQuery extensions - $.f()
 * @namespace jQuery
 * @name $
 */
/** jQuery selector extensions - $(sel).f()
 * @namespace jQuery.fn
 * @memberOf $
 * @name fn
 */

(function($) {
    /**
     * Default options. Use $.assertSetup() to override. Options:
     *
     * @param {bool} [enabled=false] Activate or de-activate module.
     * @param {String URL or $.ajax() parameter object} [ajax=null] AJAX URL or complete jQuery AJAX options.
     * @param {bool} [catchGlobalErrors=false] Catch global errors besides assertion failures?
     * @param {Funtion} [contextCallback=$.noop] A callback function(value, message, stacktrace), called to supply additional data before a failure is being reported.
     * @param {Funtion} [log=console && $.isFunction(console.log) ? $.proxy(console.log, console) : $.noop] A log function called on assertion failure.
     * @param {String} [title=Assertion failed:] Default title.
     *
     * @class
     * @name options
     * @see $.assertSetup()
     */
    var options = {
            enabled: false,
            ajax: null,
            catchGlobalErrors: false,
            contextCallback: $.noop,
            log: console && $.isFunction(console.log) ? $.proxy(console.log, console) : $.noop,
            title: "Assertion failed:",
            globalTitle: "Global error:"
    };

    /**
     **
     ** API BEGIN
     **
     **/

    /** Setup QAssert. Overrides default options,
     * @param _options Supported values: <br/>
     * 				   - empty: sets enabled to true <br/>
     *                 - string: sets enabled to true and ajax to this url <br/>
     *                 - object: sets enabled to true then overrides options with this object <br/>
     * @returns options.enabled
     * @see options
     * @public
     */
    $.assertSetup = function(_options) {
        options.enabled = true;
        if (typeof _options === "object") {
            // options given
            options = $.extend(true, options, _options);
        }
        if (typeof _options === "string") {
            // url given?
            options.ajax = _options;
        }
        if (typeof options.ajax != "object") {
            // ajax option is just an url?
            options.ajax = {
                type: "POST",
                url: options.ajax
            };
        }

        if (options.enabled && options.catchGlobalErrors) {
            window.onerror = failGlobal;
        }

        return options.enabled;
    }

    $.assertExtendContext = function(_context) {
        options.context = $.extend(options.context, _context, true);
    }

    /**
     * Selector assertion. If disabled, no-op.
     *
     * @param message	optional message
     * @param sizeOrCallback    optional
     *     - If a number, we assert that it equals to the count of selected elements.
     *       $(selector).assert("We need two elements", 2)
     *
     *     - If a function, we call sizeOrCallback(), where this is set to the jQuery object of the selection,
     *       and we assert on the return value.
     *       $(selector).assert("Must have class foo", function(subject) {return subject.hasClass("foo")})
     *
     *     - Otherwise we assert that the selection is not empty.
     *       $(selector).assert().text("FOO")
     *
     * @returns this, method chaining possible.
     * @public
     */
    $.fn.assert = function(message, sizeOrCallback, context) {
        if (options.enabled) {
            if (typeof sizeOrCallback === "number") {
                // assert on the size of the selection
                assert(this.length === sizeOrCallback, message, this, context)
            } else if (typeof sizeOrCallback === "function") {
                // do callback with selection, assert on the returned value
                var value = ($.proxy(sizeOrCallback, this))();
                assert(value, message, this, context);
            } else {
                // assert whether this contains any selected elements
                assert(this.length > 0, message, this, context);
            }
        }
        return this;
    }

    /**
     * Boolean assertion. If disabled, no-op.
     *
     * @param value    the value to assert on
     * @param message  optional message
     * @returns value
     */
    $.assert = function (value, message, context) {
        if (options.enabled) {
            assert(value, message, value, context);
        }
        return value;
    }

    /**
     * Boolean assertion for false. If disabled, no-op.
     *
     * @param value    the value to assert on
     * @param message  optional message
     * @returns value
     */
    $.assertNot = function (value, message, context) {
        if (options.enabled) {
            assert(!value, message, value, context);
        }
        return value;
    }

    /**
     * Type assertion. If disabled, no-op.
     *
     * @param value    the value to assert on
     * @param type	   expected type as string, supported:
     * 				   undefined, null, nan, number, string, boolean, array, date, regexp, function, object
     * @param message  optional message
     * @returns value
     */
    $.assertIs = function (value, type, message, context) {
        if (options.enabled) {
            var actualType = getType(value);
            assert(type === actualType, message, value, context);
        }
        return value;
    }

    /**
     * Type assertion inverted. If disabled, no-op.
     *
     * @param value    the value to assert on
     * @param type	   expected type as string, supported:
     * 				   undefined, null, nan, number, string, boolean, array, date, regexp, function, object
     * @param message  optional message
     * @returns value
     */
    $.assertNotIs = function (value, type, message, context) {
        if (options.enabled) {
            var actualType = getType(value);
            assert(type !== actualType, message, value, context);
        }
        return value;
    }

    /**
     * Empty assertion. If disabled, no-op.
     *
     * @param value    the value to assert emptiness on, supported semantics for type:
     * 				   - undefined, null, nan: true
     *                 - number: true if 0
     *                 - string: true if ""
     *                 - boolean: true if false
     *                 - array: true if []
     *                 - object: true if {}
     * @param message  optional message
     * @returns value
     */
    $.assertEmpty = function (value, message, context) {
        if (options.enabled) {
            assert(isEmpty(value), message, value, context);
        }
        return value;
    }

    /**
     * Non-empty assertion. If disabled, no-op.
     *
     * @param value    the value to assert emptiness on, semantics are the exact opposite of {@link $.assertEmpty}
     * @param message  optional message
     * @returns value
     */
    $.assertNotEmpty = function (value, message, context) {
        if (options.enabled) {
            assert(!isEmpty(value), message, value, context);
        }
        return value;
    }

    /**
     * Strict equality assertion. If disabled, no-op.
     * Uses === (see strictEquals().)
     *
     * @param value    actual value to compare
     * @param expected expected value to compare to
     * @param message  optional message
     * @returns value
     */
    $.assertSame = function (actual, expected, message, context) {
        if (options.enabled) {
            assert(strictEquals(actual, expected), message, actual, context);
        }
        return actual;
    }

    /**
     * Strict unequality assertion. If disabled, no-op.
     * Uses !== (see strictEquals().)
     *
     * @param value    actual value to compare
     * @param expected expected value to compare to
     * @param message  optional message
     * @returns value
     */
    $.assertNotSame = function (actual, expected, message, context) {
        if (options.enabled) {
            assert(!strictEquals(actual, expected), message, actual, context);
        }
        return actual;
    }

    /**
     * Equality assertion, no recursion. If disabled, no-op.
     * Uses ==, except it equals Number, RegExp, Date and NaN (see equals().)
     *
     * @param value    actual value to compare
     * @param expected expected value to compare to
     * @param message  optional message
     * @returns value
     */
    $.assertEquals = function (actual, expected, message, context) {
        if (options.enabled) {
            assert(equals(actual, expected), message, actual, context);
        }
        return actual;
    }

    /**
     * Unequality assertion, no recursion. If disabled, no-op.
     * Uses !=, except it equals Number, RegExp, Date and NaN (see equals().)
     *
     * @param value    actual value to compare
     * @param expected expected value to compare to
     * @param message  optional message
     * @returns value
     */
    $.assertNotEquals = function (actual, expected, message, context) {
        if (options.enabled) {
            assert(!equals(actual, expected), message, actual, context);
        }
        return actual;
    }

    /**
     * Recursive equality assertion. If disabled, no-op.
     * Uses deepEquals().
     *
     * @param value    actual value to compare
     * @param expected expected value to compare to
     * @param message  optional message
     * @returns value
     */
    $.assertDeepEquals = function (actual, expected, message, context) {
        if (options.enabled) {
            assert(deepEquals(actual, expected), message, actual, context);
        }
        return actual;
    }

    /**
     * Recursive unequality assertion. If disabled, no-op.
     * Uses !deepEquals().
     *
     * @param value    actual value to compare
     * @param expected expected value to compare to
     * @param message  optional message
     * @returns value
     */
    $.assertNotDeepEquals = function (actual, expected, message, context) {
        if (options.enabled) {
            assert(!deepEquals(actual, expected), message, actual, context);
        }
        return actual;
    }


    /**
     **
     ** API END
     **
     **/

    /**
     * Base assertion handler.
     */
    function assert(value, message, originalValue, context) {
        if (!value) {
            var reportValue = arguments.length < 3 ? value : originalValue;
            var stacktrace = printStackTrace({ guess: false }) 
            stacktrace = stacktrace.slice(6, stacktrace.length);
            fail(options.title, reportValue, message, stacktrace, context);
        }
    }

    /**
     * Handles a failed assertion.
     */
    function fail(title, value, message, stacktrace, context) {
        logToConsole(title, value, message, stacktrace, options.context, context);
        logToAjax(title, value, message, stacktrace, options.context, context);
    }

    /**
     * Handles window.onerror.
     */
    function failGlobal(msg, url, linenumber) {
        fail(options.globalTitle, null, msg, [url + ":" + linenumber], "global");
    }

    /**
     * Logs to options.log
     */
    function logToConsole(title, value, message, stacktrace, globalContext, context) {
        options.log(title, message, "\n",
            {
                "Value": value,
                "Stacktrace": stacktrace,
                "Global context": globalContext,
                "Local context": context
            });
    }

    /**
     * Logs to $.ajax(options.ajax)
     */
    function logToAjax(title, value, message, stacktrace, globalContext, context) {
        var params = options.ajax;
        if (params) {
            var data = {
                globalContext: JSON.stringify(globalContext),
                localContext: JSON.stringify(context),
                message: message,
                stacktrace: JSON.stringify(stacktrace),
                title: title,
                value: JSON.stringify(value)
            };
            params = $.extend(params, { data: data }, true);
            $.ajax(params);
        }
    }

    function isEmpty(value) {
        var type = getType(value);
        switch (type) {
            case "undefined":
            case "null":
            case "nan":
                return true;
            case "number":
                return value == 0;
            case "string":
                return value == "";
            case "boolean":
                return value == false;
            case "array":
                return value.length == 0;
            case "object":
                for (var v in value) {
                    if (!value.hasOwnProperty || value.hasOwnProperty(v)) {
                        return false; // property found => not empty
                    }
                }
                return true; // no property found => empty
        }
        return false; // unknown things are not empty
    }

    function strictEquals(a, b) {
        return a === b;
    }

    function equals(a, b) {
        if (a == b) {
            return true;
        }
        var type = getType(a);
        switch (type) {
            case "nan":
                return isNaN(b);
            case "date":
                return getType(b) === "date" && a.valueOf() === b.valueOf();
            case "number":
                return getType(b) === "number" && a.valueOf() === b.valueOf()
            case "regexp":
                return getType(b) === "regexp" &&
                    a.source === b.source && // the regex itself
                    a.global === b.global && // and its modifers (gmi) ...
                    a.ignoreCase === b.ignoreCase &&
                    a.multiline === b.multiline;
        }
        return false;
    }

    function getType(obj) {
        if (typeof obj === "undefined") {
            return "undefined";

        // consider: typeof null === object
        }
        if (obj === null) {
            return "null";
        }

        var type = Object.prototype.toString.call( obj )
          .match(/^\[object\s(.*)\]$/)[1] || '';

        switch (type) {
            case 'Number':
                if (isNaN(obj)) {
                    return "nan";
                } else {
                    return "number";
                }
            case 'String':
            case 'Boolean':
            case 'Array':
            case 'Date':
            case 'RegExp':
            case 'Function':
                return type.toLowerCase();
        }
        if (typeof obj === "object") {
            return "object";
        }
        return undefined;
    }

    /**
     **
     ** MICRO LIBRARIES
     **
     ** - Recursive equality.
     ** - Stacktrace.
     **
     **/

    /**
     * Recursive equality testing.
     * Extracted from QUnit.
     *
     * Test for equality any JavaScript type.
     * Discussions and reference: http://philrathe.com/articles/equiv
     * Test suites: http://philrathe.com/tests/equiv
     * Author: Philippe Rathé <prathe@gmail.com>
     */
    var deepEquals = function (){

        var innerEquiv; // the real equiv function
        var callers = []; // stack to decide between skip/abort functions
        var parents = []; // stack to avoiding loops from circular referencing

        // Call the o related callback with the given arguments.
        function bindCallbacks(o, callbacks, args) {
            var prop = getType(o);
            if (prop) {
                if (getType(callbacks[prop]) === "function") {
                    return callbacks[prop].apply(callbacks, args);
                } else {
                    return callbacks[prop]; // or undefined
                }
            }
        }

        var callbacks = function () {

            // for string, boolean, number and null
            function useStrictEquality(b, a) {
                return a === b;
            }

            return {
                "string": useStrictEquality,
                "boolean": useStrictEquality,
                "number": useStrictEquality,
                "null": useStrictEquality,
                "undefined": useStrictEquality,

                "nan": function (b) {
                    return isNaN(b);
                },

                "date": function (b, a) {
                    return getType(b) === "date" && a.valueOf() === b.valueOf();
                },

                "regexp": function (b, a) {
                    return getType(b) === "regexp" &&
                        a.source === b.source && // the regex itself
                        a.global === b.global && // and its modifers (gmi) ...
                        a.ignoreCase === b.ignoreCase &&
                        a.multiline === b.multiline;
                },

                // - skip when the property is a method of an instance (OOP)
                // - abort otherwise,
                // initial === would have catch identical references anyway
                "function": function () {
                    var caller = callers[callers.length - 1];
                    return caller !== Object &&
                            typeof caller !== "undefined";
                },

                "array": function (b, a) {
                    var i, j, loop;
                    var len;

                    // b could be an object literal here
                    if ( ! (getType(b) === "array")) {
                        return false;
                    }

                    len = a.length;
                    if (len !== b.length) { // safe and faster
                        return false;
                    }

                    //track reference to avoid circular references
                    parents.push(a);
                    for (i = 0; i < len; i++) {
                        loop = false;
                        for(j=0;j<parents.length;j++){
                            if(parents[j] === a[i]){
                                loop = true;//dont rewalk array
                            }
                        }
                        if (!loop && ! innerEquiv(a[i], b[i])) {
                            parents.pop();
                            return false;
                        }
                    }
                    parents.pop();
                    return true;
                },

                "object": function (b, a) {
                    var i, j, loop;
                    var eq = true; // unless we can proove it
                    var aProperties = [], bProperties = []; // collection of strings

                    // comparing constructors is more strict than using instanceof
                    if ( a.constructor !== b.constructor) {
                        return false;
                    }

                    // stack constructor before traversing properties
                    callers.push(a.constructor);
                    //track reference to avoid circular references
                    parents.push(a);

                    for (i in a) { // be strict: don't ensures hasOwnProperty and go deep
                        loop = false;
                        for(j=0;j<parents.length;j++){
                            if(parents[j] === a[i])
                                loop = true; //don't go down the same path twice
                        }
                        aProperties.push(i); // collect a's properties

                        if (!loop && ! innerEquiv(a[i], b[i])) {
                            eq = false;
                            break;
                        }
                    }

                    callers.pop(); // unstack, we are done
                    parents.pop();

                    for (i in b) {
                        bProperties.push(i); // collect b's properties
                    }

                    // Ensures identical properties name
                    return eq && innerEquiv(aProperties.sort(), bProperties.sort());
                }
            };
        }();

        var innerEquiv = function () { // can take multiple arguments
            var args = Array.prototype.slice.apply(arguments);
            if (args.length < 2) {
                return true; // end transition
            }

            return (function (a, b) {
                if (a === b) {
                    return true; // catch the most you can
                } else if (a === null || b === null || typeof a === "undefined" || typeof b === "undefined" || getType(a) !== getType(b)) {
                    return false; // don't lose time with error prone cases
                } else {
                    return bindCallbacks(a, callbacks, [b, a]);
                }

            // apply transition with (1..n) arguments
            })(args[0], args[1]) && arguments.callee.apply(this, args.splice(1, args.length -1));
        };

        return innerEquiv;

    }();

    /*
     * Get the stacktraces in all web browsers.
     * https://github.com/emwendelin/javascript-stacktrace
     */

    // Domain Public by Eric Wendelin http://eriwen.com/ (2008)
    //                  Luke Smith http://lucassmith.name/ (2008)
    //                  Loic Dachary <loic@dachary.org> (2008)
    //                  Johan Euphrosine <proppy@aminche.com> (2008)
    //                  Øyvind Sean Kinsey http://kinsey.no/blog (2010)
    //                  Victor Homyakov <victor-homyakov@users.sourceforge.net> (2010)
    //
    // Information and discussions
    // http://jspoker.pokersource.info/skin/test-printstacktrace.html
    // http://eriwen.com/javascript/js-stack-trace/
    // http://eriwen.com/javascript/stacktrace-update/
    // http://pastie.org/253058
    //
    // guessFunctionNameFromLines comes from firebug
    //
    // Software License Agreement (BSD License)
    //
    // Copyright (c) 2007, Parakey Inc.
    // All rights reserved.
    //
    // Redistribution and use of this software in source and binary forms, with or without modification,
    // are permitted provided that the following conditions are met:
    //
    // * Redistributions of source code must retain the above
    //   copyright notice, this list of conditions and the
    //   following disclaimer.
    //
    // * Redistributions in binary form must reproduce the above
    //   copyright notice, this list of conditions and the
    //   following disclaimer in the documentation and/or other
    //   materials provided with the distribution.
    //
    // * Neither the name of Parakey Inc. nor the names of its
    //   contributors may be used to endorse or promote products
    //   derived from this software without specific prior
    //   written permission of Parakey Inc.
    //
    // THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
    // IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
    // FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
    // CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
    // DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
    // DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
    // IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
    // OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


    /**
     * Main function giving a function stack trace with a forced or passed in Error
     *
     * @cfg {Error} e The error to create a stacktrace from (optional)
     * @cfg {Boolean} guess If we should try to resolve the names of anonymous functions
     * @return {Array} of Strings with functions, lines, files, and arguments where possible
     */
    function printStackTrace(options) {
        var ex = (options && options.e) ? options.e : null;
        var guess = options ? !!options.guess : true;

        var p = new printStackTrace.implementation();
        var result = p.run(ex);
        return (guess) ? p.guessFunctions(result) : result;
    }

    printStackTrace.implementation = function() {};

    printStackTrace.implementation.prototype = {
        run: function(ex) {
            ex = ex ||
                (function() {
                    try {
                        this.undef();
                        return null;
                    } catch (e) {
                        return e;
                    }
                })();
            // Use either the stored mode, or resolve it
            var mode = this._mode || this.mode(ex);
            if (mode === 'other') {
                return this.other(arguments.callee);
            } else {
                return this[mode](ex);
            }
        },

        /**
         * @return {String} mode of operation for the environment in question.
         */
        mode: function(e) {
            if (e['arguments']) {
                return (this._mode = 'chrome');
            } else if (typeof window !== 'undefined' && window.opera && e.stacktrace) {
                return (this._mode = 'opera10');
            } else if (e.stack) {
                return (this._mode = 'firefox');
            } else if (typeof window !== 'undefined' && window.opera && !('stacktrace' in e)) { //Opera 9-
                return (this._mode = 'opera');
            }
            return (this._mode = 'other');
        },

        /**
         * Given a context, function name, and callback function, overwrite it so that it calls
         * printStackTrace() first with a callback and then runs the rest of the body.
         *
         * @param {Object} context of execution (e.g. window)
         * @param {String} functionName to instrument
         * @param {Function} function to call with a stack trace on invocation
         */
        instrumentFunction: function(context, functionName, callback) {
            context = context || window;
            context['_old' + functionName] = context[functionName];
            context[functionName] = function() {
                callback.call(this, printStackTrace());
                return context['_old' + functionName].apply(this, arguments);
            };
            context[functionName]._instrumented = true;
        },

        /**
         * Given a context and function name of a function that has been
         * instrumented, revert the function to it's original (non-instrumented)
         * state.
         *
         * @param {Object} context of execution (e.g. window)
         * @param {String} functionName to de-instrument
         */
        deinstrumentFunction: function(context, functionName) {
            if (context[functionName].constructor === Function &&
                    context[functionName]._instrumented &&
                    context['_old' + functionName].constructor === Function) {
                context[functionName] = context['_old' + functionName];
            }
        },

        /**
         * Given an Error object, return a formatted Array based on Chrome's stack string.
         *
         * @param e - Error object to inspect
         * @return Array<String> of function calls, files and line numbers
         */
        chrome: function(e) {
            return e.stack.replace(/^[^\(]+?[\n$]/gm, '').replace(/^\s+at\s+/gm, '').replace(/^Object.<anonymous>\s*\(/gm, '{anonymous}()@').split('\n');
        },

        /**
         * Given an Error object, return a formatted Array based on Firefox's stack string.
         *
         * @param e - Error object to inspect
         * @return Array<String> of function calls, files and line numbers
         */
        firefox: function(e) {
            return e.stack.replace(/(?:\n@:0)?\s+$/m, '').replace(/^\(/gm, '{anonymous}(').split('\n');
        },

        /**
         * Given an Error object, return a formatted Array based on Opera 10's stacktrace string.
         *
         * @param e - Error object to inspect
         * @return Array<String> of function calls, files and line numbers
         */
        opera10: function(e) {
            var stack = e.stacktrace;
            var lines = stack.split('\n'), ANON = '{anonymous}',
                lineRE = /.*line (\d+), column (\d+) in ((<anonymous function\:?\s*(\S+))|([^\(]+)\([^\)]*\))(?: in )?(.*)\s*$/i, i, j, len;
            for (i = 2, j = 0, len = lines.length; i < len - 2; i++) {
                if (lineRE.test(lines[i])) {
                    var location = RegExp.$6 + ':' + RegExp.$1 + ':' + RegExp.$2;
                    var fnName = RegExp.$3;
                    fnName = fnName.replace(/<anonymous function\:?\s?(\S+)?>/g, ANON);
                    lines[j++] = fnName + '@' + location;
                }
            }

            lines.splice(j, lines.length - j);
            return lines;
        },

        // Opera 7.x-9.x only!
        opera: function(e) {
            var lines = e.message.split('\n'), ANON = '{anonymous}',
                lineRE = /Line\s+(\d+).*script\s+(http\S+)(?:.*in\s+function\s+(\S+))?/i,
                i, j, len;

            for (i = 4, j = 0, len = lines.length; i < len; i += 2) {
                //TODO: RegExp.exec() would probably be cleaner here
                if (lineRE.test(lines[i])) {
                    lines[j++] = (RegExp.$3 ? RegExp.$3 + '()@' + RegExp.$2 + RegExp.$1 : ANON + '()@' + RegExp.$2 + ':' + RegExp.$1) + ' -- ' + lines[i + 1].replace(/^\s+/, '');
                }
            }

            lines.splice(j, lines.length - j);
            return lines;
        },

        // Safari, IE, and others
        other: function(curr) {
            var ANON = '{anonymous}', fnRE = /function\s*([\w\-$]+)?\s*\(/i,
                stack = [], fn, args, maxStackSize = 10;

            while (curr && stack.length < maxStackSize) {
                fn = fnRE.test(curr.toString()) ? RegExp.$1 || ANON : ANON;
                args = Array.prototype.slice.call(curr['arguments'] || []);
                stack[stack.length] = fn + '(' + this.stringifyArguments(args) + ')';
                curr = curr.caller;
            }
            return stack;
        },

        /**
         * Given arguments array as a String, subsituting type names for non-string types.
         *
         * @param {Arguments} object
         * @return {Array} of Strings with stringified arguments
         */
        stringifyArguments: function(args) {
            for (var i = 0; i < args.length; ++i) {
                var arg = args[i];
                if (arg === undefined) {
                    args[i] = 'undefined';
                } else if (arg === null) {
                    args[i] = 'null';
                } else if (arg.constructor) {
                    if (arg.constructor === Array) {
                        if (arg.length < 3) {
                            args[i] = '[' + this.stringifyArguments(arg) + ']';
                        } else {
                            args[i] = '[' + this.stringifyArguments(Array.prototype.slice.call(arg, 0, 1)) + '...' + this.stringifyArguments(Array.prototype.slice.call(arg, -1)) + ']';
                        }
                    } else if (arg.constructor === Object) {
                        args[i] = '#object';
                    } else if (arg.constructor === Function) {
                        args[i] = '#function';
                    } else if (arg.constructor === String) {
                        args[i] = '"' + arg + '"';
                    }
                }
            }
            return args.join(',');
        },

        sourceCache: {},

        /**
         * @return the text from a given URL.
         */
        ajax: function(url) {
            var req = this.createXMLHTTPObject();
            if (!req) {
                return;
            }
            req.open('GET', url, false);
            req.setRequestHeader('User-Agent', 'XMLHTTP/1.0');
            req.send('');
            return req.responseText;
        },

        /**
         * Try XHR methods in order and store XHR factory.
         *
         * @return <Function> XHR function or equivalent
         */
        createXMLHTTPObject: function() {
            var xmlhttp, XMLHttpFactories = [
                function() {
                    return new XMLHttpRequest();
                }, function() {
                    return new ActiveXObject('Msxml2.XMLHTTP');
                }, function() {
                    return new ActiveXObject('Msxml3.XMLHTTP');
                }, function() {
                    return new ActiveXObject('Microsoft.XMLHTTP');
                }
            ];
            for (var i = 0; i < XMLHttpFactories.length; i++) {
                try {
                    xmlhttp = XMLHttpFactories[i]();
                    // Use memoization to cache the factory
                    this.createXMLHTTPObject = XMLHttpFactories[i];
                    return xmlhttp;
                } catch (e) {}
            }
        },

        /**
         * Given a URL, check if it is in the same domain (so we can get the source
         * via Ajax).
         *
         * @param url <String> source url
         * @return False if we need a cross-domain request
         */
        isSameDomain: function(url) {
            return url.indexOf(location.hostname) !== -1;
        },

        /**
         * Get source code from given URL if in the same domain.
         *
         * @param url <String> JS source URL
         * @return <Array> Array of source code lines
         */
        getSource: function(url) {
            if (!(url in this.sourceCache)) {
                this.sourceCache[url] = this.ajax(url).split('\n');
            }
            return this.sourceCache[url];
        },

        guessFunctions: function(stack) {
            for (var i = 0; i < stack.length; ++i) {
                var reStack = /\{anonymous\}\(.*\)@(\w+:\/\/([\-\w\.]+)+(:\d+)?[^:]+):(\d+):?(\d+)?/;
                var frame = stack[i], m = reStack.exec(frame);
                if (m) {
                    var file = m[1], lineno = m[4]; //m[7] is character position in Chrome
                    if (file && this.isSameDomain(file) && lineno) {
                        var functionName = this.guessFunctionName(file, lineno);
                        stack[i] = frame.replace('{anonymous}', functionName);
                    }
                }
            }
            return stack;
        },

        guessFunctionName: function(url, lineNo) {
            var ret;
            try {
                ret = this.guessFunctionNameFromLines(lineNo, this.getSource(url));
            } catch (e) {
                ret = 'getSource failed with url: ' + url + ', exception: ' + e.toString();
            }
            return ret;
        },

        guessFunctionNameFromLines: function(lineNo, source) {
            var reFunctionArgNames = /function ([^(]*)\(([^)]*)\)/;
            var reGuessFunction = /['"]?([0-9A-Za-z_]+)['"]?\s*[:=]\s*(function|eval|new Function)/;
            // Walk backwards from the first line in the function until we find the line which
            // matches the pattern above, which is the function definition
            var line = "", maxLines = 10;
            for (var i = 0; i < maxLines; ++i) {
                line = source[lineNo - i] + line;
                if (line !== undefined) {
                    var m = reGuessFunction.exec(line);
                    if (m && m[1]) {
                        return m[1];
                    } else {
                        m = reFunctionArgNames.exec(line);
                        if (m && m[1]) {
                            return m[1];
                        }
                    }
                }
            }
            return '(?)';
        }
    };

    /**
     **
     **    END OF STACKTRACE
     **
     **/

})(jQuery);
