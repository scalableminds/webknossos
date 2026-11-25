// Entry point of the layer registration pages, which are loaded on demand when one of them is
// opened (see router/router.tsx). Only few users open them, so their code is not part of the
// initially loaded code of the other pages. Outside of these pages, only import light-weight
// layer registration modules (e.g., layer_registration_protocol). `yarn build` fails if this
// entry becomes part of the initially loaded code (see
// frontend/vite/vite-plugin-assert-code-splitting.ts).
export { default as LayerRegistrationListView } from "./layer_registration_list_view";
export { default as LayerRegistrationView } from "./layer_registration_view";
