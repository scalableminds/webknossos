import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import type React from "react";
import { useState } from "react";
import { useEffectOnlyOnce } from "libs/react_hooks";

type Props = {
  redirectTo: () => Promise<string>;
  history: RouteComponentProps["history"];
  pushToHistory?: boolean;
  errorComponent?: React.ReactNode;
};

const AsyncRedirect: React.FC<Props> = ({
  redirectTo,
  history,
  pushToHistory = true,
  errorComponent,
}: Props) => {
  const [hasError, setHasError] = useState(false);
  useEffectOnlyOnce(() => {
    const performRedirect = async () => {
      try {
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
      } catch (e) {
        setHasError(true);
        throw e;
      }
    };
    performRedirect();
  });

  return hasError && errorComponent ? errorComponent : null;
};

export default withRouter<RouteComponentProps & Props, any>(AsyncRedirect);
