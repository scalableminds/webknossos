// @noflow
// @ts-expect-error ts-migrate(2451) FIXME: Cannot redeclare block-scoped variable 'AbortContr... Remove this comment to see the full error message
const { AbortController, AbortSignal } = require("abort-controller");

// @ts-expect-error ts-migrate(2451) FIXME: Cannot redeclare block-scoped variable 'DOMExcepti... Remove this comment to see the full error message
const DOMException = require("domexception");

global.AbortController = AbortController;
global.AbortSignal = AbortSignal;
global.DOMException = DOMException;
