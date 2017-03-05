/**
 * viewmode_right_menu_view.js
 * @flow weak
 */

import AbstractTabView from "oxalis/view/abstract_tab_view";
import DatasetInfoView from "oxalis/view/viewmode/right-menu/dataset_info_view";

class ViewmodeRightMenuView extends AbstractTabView {

  getTabs() {
    return [
      {
        id: "tab-info",
        name: "Info",
        viewClass: DatasetInfoView,
      },
    ];
  }
}

export default ViewmodeRightMenuView;
