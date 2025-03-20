import { useEffectOnlyOnce } from "libs/react_hooks";
import type React from "react";
import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";

type Props = {
  redirectTo: () => Promise<string>;
  history: RouteComponentProps["history"];
  pushToHistory?: boolean;
};

const AsyncRedirect: React.FC<Props> = ({ redirectTo, history, pushToHistory = true }) => {
  useEffectOnlyOnce(() => {
    const redirect = async () => {
      const newPath = await redirectTo();

      if (newPath.startsWith(location.origin)) {
        // The link is absolute which react-router does not support
        // apparently. See https://stackoverflow.com/questions/42914666/react-router-external-link
        if (pushToHistory) {
          location.assign(newPath);
        } else {
          location.replace(newPath);
        }
        return;
      }

      if (pushToHistory) {
        history.push(newPath);
      } else {
        history.replace(newPath);
      }
    };

    redirect();
  });

  return null;
};

export default withRouter<RouteComponentProps & Props, any>(AsyncRedirect);
