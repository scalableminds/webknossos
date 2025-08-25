import window from "libs/window";
import React from "react";

const preventDefault = (e: Event) => {
  e.preventDefault();
};

export default function DisableGenericDnd() {
  React.useEffect(() => {
    window.addEventListener("dragover", preventDefault, false);
    window.addEventListener("drop", preventDefault, false);

    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
    };
  }, []);

  return null;
}
