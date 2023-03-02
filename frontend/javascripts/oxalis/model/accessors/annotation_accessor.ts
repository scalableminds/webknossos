import { OxalisState } from "oxalis/store";

export function mayEditAnnotationProperties(state: OxalisState) {
  const { owner, restrictions } = state.tracing;
  const activeUser = state.activeUser;

  return !!(
    restrictions.allowUpdate &&
    restrictions.allowSave &&
    activeUser &&
    owner?.id === activeUser.id
  );
}
