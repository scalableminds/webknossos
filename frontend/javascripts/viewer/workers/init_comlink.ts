import * as Comlink from "comlink";
import {
  requestOptionsTransferHandler,
  throwTransferHandlerWithResponseSupport,
} from "./headers_transfer_handler";

Comlink.transferHandlers.set("requestOptions", requestOptionsTransferHandler);
Comlink.transferHandlers.set("throw", throwTransferHandlerWithResponseSupport);
