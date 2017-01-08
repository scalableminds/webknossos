import AbstractTabView from "../abstract_tab_view";
import DatasetInfoView from "./right-menu/dataset_info_view";

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
