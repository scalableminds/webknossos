// @flow
import { useEffect } from "react";

import { disableViewportMetatag } from "libs/utils";

// For registered users, webKnossos should behave similar to
// the desktop's browser behavior. Therefore, we clear the
// viewport meta tag.

export default function AdaptViewportMetatag({ isAuthenticated }: { isAuthenticated: boolean }) {
  useEffect(() => {
    if (isAuthenticated) {
      disableViewportMetatag();
    }
  }, [isAuthenticated]);

  return null;
}
