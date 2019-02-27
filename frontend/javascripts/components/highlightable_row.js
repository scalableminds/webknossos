// @flow
import * as React from "react";

type Props = {
  shouldHighlight: boolean,
  children: React.Node,
  style?: Object,
};

type State = {
  persistedShouldHighlight: boolean,
};

// This component is able to highlight a newly rendered row.
// Internally, it persists the initially passed props, since that
// prop can change faster than the animation is executed. Not saving
// the initial prop, would abort the animation too early.
export default class HighlightableRow extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super();
    this.state = {
      persistedShouldHighlight: props.shouldHighlight,
    };
  }

  render() {
    const { shouldHighlight, style, ...restProps } = this.props;
    return (
      <tr
        {...restProps}
        style={{
          ...style,
          animation: this.state.persistedShouldHighlight ? "highlight-background 2.0s ease" : "",
        }}
      >
        {this.props.children}
      </tr>
    );
  }
}
