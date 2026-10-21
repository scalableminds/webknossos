import { SettingOutlined } from "@ant-design/icons";
import { Button, InputNumber, Space, Tooltip, Typography } from "antd";
import Toast from "libs/toast";
import { Fragment, useState } from "react";

type Props = {
  // Smallest and newest version that can be navigated to.
  minVersion: number;
  newestVersion: number;
  // Disables all controls while a version is being loaded.
  disabled: boolean;
  // Resolves to false if the version could not be activated.
  onNavigateToVersion: (version: number) => Promise<boolean>;
};

type BisectState =
  | { type: "running"; good: number; bad: number; current: number }
  | { type: "finished"; firstBad: number };

function getMiddleVersion(good: number, bad: number) {
  return Math.floor((good + bad) / 2);
}

function getRemainingSteps(good: number, bad: number) {
  return Math.ceil(Math.log2(bad - good));
}

export function VersionPowerToolsToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip title="Advanced tools (go to version, bisect)" placement="left">
      <Button
        type="text"
        size="small"
        icon={<SettingOutlined />}
        onClick={onToggle}
        style={{ opacity: isOpen ? 1 : 0.5 }}
      />
    </Tooltip>
  );
}

export default function VersionPowerTools({
  minVersion,
  newestVersion,
  disabled,
  onNavigateToVersion,
}: Props) {
  const [versionToGoTo, setVersionToGoTo] = useState<number | null>(null);
  const [goodInput, setGoodInput] = useState<number | null>(null);
  const [badInput, setBadInput] = useState<number | null>(null);
  const [bisectState, setBisectState] = useState<BisectState | null>(null);

  const isValidVersion = (version: number | null): version is number =>
    version != null &&
    Number.isInteger(version) &&
    version >= minVersion &&
    version <= newestVersion;

  const handleGoToVersion = async () => {
    if (!isValidVersion(versionToGoTo)) {
      Toast.warning(`Please enter a version between ${minVersion} and ${newestVersion}.`);
      return;
    }
    await onNavigateToVersion(versionToGoTo);
  };

  // Moves the bisection forward with the given (narrowed) range.
  const continueBisect = async (good: number, bad: number) => {
    if (bad - good <= 1) {
      setBisectState({ type: "finished", firstBad: bad });
      await onNavigateToVersion(bad);
      return;
    }
    const current = getMiddleVersion(good, bad);
    if (await onNavigateToVersion(current)) {
      setBisectState({ type: "running", good, bad, current });
    }
  };

  const handleStartBisect = async () => {
    if (!isValidVersion(goodInput) || !isValidVersion(badInput)) {
      Toast.warning(
        `Please enter a good and a bad version between ${minVersion} and ${newestVersion}.`,
      );
      return;
    }
    if (goodInput >= badInput) {
      Toast.warning("The good version has to be older than the bad version.");
      return;
    }
    await continueBisect(goodInput, badInput);
  };

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <Space.Compact size="small" style={{ width: "100%" }}>
        <InputNumber
          style={{ flex: 1 }}
          placeholder="Go to version"
          min={minVersion}
          max={newestVersion}
          precision={0}
          value={versionToGoTo}
          onChange={setVersionToGoTo}
          onPressEnter={handleGoToVersion}
          disabled={disabled}
        />
        <Button onClick={handleGoToVersion} disabled={disabled}>
          Go
        </Button>
      </Space.Compact>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Bisect
        </Typography.Text>
        {bisectState?.type === "running" ? (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              Testing version <b>{bisectState.current}</b> (good: {bisectState.good}, bad:{" "}
              {bisectState.bad}, ~{getRemainingSteps(bisectState.good, bisectState.bad)} steps left)
            </div>
            <Space size="small">
              <Button
                size="small"
                disabled={disabled}
                onClick={() => continueBisect(bisectState.current, bisectState.bad)}
              >
                Good
              </Button>
              <Button
                size="small"
                danger
                disabled={disabled}
                onClick={() => continueBisect(bisectState.good, bisectState.current)}
              >
                Bad
              </Button>
              <Button size="small" type="text" onClick={() => setBisectState(null)}>
                Stop
              </Button>
            </Space>
          </div>
        ) : bisectState?.type === "finished" ? (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              First bad version: <b>{bisectState.firstBad}</b>
            </div>
            <Button size="small" onClick={() => setBisectState(null)}>
              Reset
            </Button>
          </div>
        ) : (
          <Fragment>
            <InputNumber
              size="small"
              style={{ flex: 1, minWidth: 0 }}
              placeholder="Good"
              min={minVersion}
              max={newestVersion}
              precision={0}
              value={goodInput}
              onChange={setGoodInput}
              disabled={disabled}
            />
            <InputNumber
              size="small"
              style={{ flex: 1, minWidth: 0 }}
              placeholder="Bad"
              min={minVersion}
              max={newestVersion}
              precision={0}
              value={badInput}
              onChange={setBadInput}
              disabled={disabled}
            />
            <Button size="small" onClick={handleStartBisect} disabled={disabled}>
              Start bisect
            </Button>
          </Fragment>
        )}
      </div>
    </div>
  );
}
