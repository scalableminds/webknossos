import Icon, { ArrowsAltOutlined } from "@ant-design/icons";
import RulerIcon from "@images/icons/icon-ruler.svg?react";
import { notification } from "antd";
import { formatLengthAsVx } from "libs/format_utils";
import messages from "messages";
import { LongUnitToShortUnitMap } from "viewer/constants";
import { api } from "viewer/singletons";
import Store from "viewer/store";
import { CopyableLength } from "viewer/view/components/copyable_length";

export function showTreeLengthNotification(treeId: number, treeName: string) {
  const datasetUnit = Store.getState().dataset.dataSource.scale.unit;
  const [lengthInUnit, lengthInVx] = api.tracing.measureTreeLength(treeId);

  notification.open({
    title: messages["tracing.tree_length_notification"](
      treeName,
      <CopyableLength length={lengthInUnit} unit={LongUnitToShortUnitMap[datasetUnit]} />,
      formatLengthAsVx(lengthInVx),
    ),
    icon: <Icon component={RulerIcon} />,
  });
}

export function showAllSkeletonsLengthNotification() {
  const datasetUnit = Store.getState().dataset.dataSource.scale.unit;
  const [totalLengthInUnit, totalLengthInVx] = api.tracing.measureAllTrees();

  notification.open({
    title: (
      <>
        The total length of all skeletons is{" "}
        <CopyableLength length={totalLengthInUnit} unit={LongUnitToShortUnitMap[datasetUnit]} /> (
        {formatLengthAsVx(totalLengthInVx)}).
      </>
    ),
    icon: <ArrowsAltOutlined />,
  });
}
