import _ from "lodash";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";

class ScriptListItemView extends Marionette.View {

  template = () => {
    return _.template(`\
<td class="monospace-id"><%- id %></td>
<td><%- name %></td>
`);
  }

}

export default ScriptListItemView;
