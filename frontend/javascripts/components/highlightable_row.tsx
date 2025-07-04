import type React from "react";
import { useState } from "react";

type Props = {
  shouldHighlight: boolean;
  children: React.ReactNode;
  style?: Record<string, any>;
};

// This component is able to highlight a newly rendered row.
// Internally, it persists the initially passed props, since that
// prop can change faster than the animation is executed. Not saving
// the initial prop, would abort the animation too early.
export default function HighlightableRow({ shouldHighlight, style, ...restProps }: Props) {
  const [persistedShouldHighlight] = useState(shouldHighlight);

  return (
    <tr
      {...restProps}
      style={{
        ...style,
        animation: persistedShouldHighlight ? "highlight-background 2.0s ease" : "",
      }}
    >
      {restProps.children}
    </tr>
  );
}
