import importDynamic from "libs/import_dynamic";

// The protobuf helpers (and with them protobufjs) are only needed by the viewer, which also
// imports them statically. Importing them dynamically here keeps them out of the initially
// loaded code of all other pages. Within the viewer, the module is already loaded.
// The promise is shared by all callers, since vitest returns the unmocked module to all but
// the first of several concurrent dynamic imports of a mocked module. A failed import is not
// kept, so that a later call can try again.
let protoHelpersPromise: Promise<typeof import("viewer/model/helpers/proto_helpers")> | null = null;
export function loadProtoHelpers() {
  protoHelpersPromise ??= importDynamic(() => import("viewer/model/helpers/proto_helpers")).catch(
    (error) => {
      protoHelpersPromise = null;
      throw error;
    },
  );
  return protoHelpersPromise;
}
