import { ReloadOutlined } from "@ant-design/icons";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import { ensureHasNewestVersionAction } from "viewer/model/actions/save_actions";

export function DebugInfo() {
  const dispatch = useDispatch();
  const versionOnClient = useWkSelector((state) => {
    return state.annotation.version;
  });
  return (
    <>
      Version: {versionOnClient}
      <ReloadOutlined onClick={() => dispatch(ensureHasNewestVersionAction(() => {}))} />{" "}
    </>
  );
}
