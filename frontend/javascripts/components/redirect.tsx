import { useEffectOnlyOnce } from "libs/react_hooks";
import type React from "react";
import { useNavigate } from "react-router-dom";

type Props = {
  redirectTo: () => Promise<string>;
  pushToHistory?: boolean;
};

const AsyncRedirect: React.FC<Props> = ({ redirectTo, pushToHistory = true }) => {
  const navigate = useNavigate();
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
        navigate(newPath);
      } else {
        navigate(newPath, { replace: true });
      }
    };

    redirect();
  });

  return null;
};

export default AsyncRedirect;
