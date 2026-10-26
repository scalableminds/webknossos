// Entry point of the viewer, which is loaded on demand when a dataset or an annotation is opened
// (see router/route_wrappers.tsx). Code that is only reachable from here (the Model, the sagas,
// most reducers, three.js, ...) is not part of the initially loaded code of the other pages.
// Keep it that way: outside of the viewer, only import light-weight viewer modules (e.g., the
// actions, constants, dataset_accessor or annotation_accessor). A single import of a heavier
// one (e.g., skeletontracing_accessor, which depends on three.js) pulls large parts of the
// viewer back into every page.
import TracingLayoutView from "viewer/view/layouting/tracing_layout_view";
import { setupViewer } from "viewer/viewer_setup";

setupViewer();

export default TracingLayoutView;
