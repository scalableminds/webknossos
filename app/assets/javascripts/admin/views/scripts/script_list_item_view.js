import _ from "lodash";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";

class ScriptListItemView extends Marionette.View {

  template = () => {
    return _.template(`\
<td><%- name %></td>
<td><%- owner %></td>
<td><a href="<%- gist %>"></td>
`);
  }

}

export default ScriptListItemView;
