import React from "react";
import { connect } from "react-redux";
import Model from "oxalis/model";
import ButtonComponent from "oxalis/view/components/button_component";
import type { OxalisState } from "oxalis/store";

class SaveButton extends React.PureComponent {
  props: {
    onClick: Function,
  };

  getSaveButtonIcon() {
    if (!Model.stateSaved()) {
      return "hourglass";
    } else {
      return "check";
    }
  }

  render() {
    return (
      <ButtonComponent
        key="save-button"
        type="primary"
        onClick={this.props.onClick}
        icon={this.getSaveButtonIcon()}
      >
        Save
      </ButtonComponent>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    save: state.save,
  };
}

export default connect(mapStateToProps)(SaveButton);
