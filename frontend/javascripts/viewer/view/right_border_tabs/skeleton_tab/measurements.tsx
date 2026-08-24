import Icon, { ArrowsAltOutlined } from "@ant-design/icons";
import RulerIcon from "@images/icons/icon-ruler.svg?react";
import { notification } from "antd";
import { formatLengthAsVx, formatNumberToLength } from "libs/format_utils";
import messages from "messages";
import { LongUnitToShortUnitMap } from "viewer/constants";
import { api } from "viewer/singletons";
import Store from "viewer/store";

export function showTreeLengthNotification(treeId: number, treeName: string) {
  const datasetUnit = Store.getState().dataset.dataSource.scale.unit;
  const [lengthInUnit, lengthInVx] = api.tracing.measureTreeLength(treeId);

  notification.open({
    title: messages["tracing.tree_length_notification"](
      treeName,
      formatNumberToLength(lengthInUnit, LongUnitToShortUnitMap[datasetUnit]),
      formatLengthAsVx(lengthInVx),
    ),
    icon: <Icon component={RulerIcon} />,
  });
}

export function showAllSkeletonsLengthNotification() {
  const datasetUnit = Store.getState().dataset.dataSource.scale.unit;
  const [totalLengthInUnit, totalLengthInVx] = api.tracing.measureAllTrees();

  notification.open({
    title: `The total length of all skeletons is ${formatNumberToLength(
      totalLengthInUnit,
      LongUnitToShortUnitMap[datasetUnit],
    )} (${formatLengthAsVx(totalLengthInVx)}).`,
    icon: <ArrowsAltOutlined />,
  });
}
