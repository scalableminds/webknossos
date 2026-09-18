import { Input, type InputRef, Typography } from "antd";
import { useEffect, useRef } from "react";

type Props = {
  // What is rendered while not editing (e.g. "Segment 5" for an unnamed segment).
  displayedName: string;
  // What the input starts with. Differs from displayedName wherever the displayed
  // text is a fallback rather than a stored name.
  editableValue: string;
  placeholder: string;
  isEditing: boolean;
  disableEditing: boolean;
  // Single-line with an end ellipsis. Off for the expanded row, which wraps instead.
  ellipsis: boolean;
  strong?: boolean;
  style?: React.CSSProperties;
  // Omitted for a name that is not truncated (the expanded row shows it in full).
  title?: string | undefined;
  onClick?: (() => void) | undefined;
  onStartEditing: () => void;
  onCommit: (newName: string) => void;
  onFinishEditing: () => void;
};

/*
 * A name that turns into an input on double-click (or whenever `isEditing` is set from
 * the outside, e.g. by the "Rename" context menu entry).
 *
 * Editing is fully controlled by the owner, so that exactly one row of the tree can be
 * in edit mode and the tree can suspend drag & drop while it is. This is deliberately
 * not <EditableTextLabel />: the segment list needs the name to be a plain flex item
 * that truncates (or wraps) inside the row, and it no longer shows an edit pencil.
 */
export function InlineEditableName({
  displayedName,
  editableValue,
  placeholder,
  isEditing,
  disableEditing,
  ellipsis,
  strong,
  style,
  title,
  onClick,
  onStartEditing,
  onCommit,
  onFinishEditing,
}: Props) {
  const inputRef = useRef<InputRef>(null);

  // Deliberately not `autoFocus`. React applies that during the commit in which the input
  // mounts, and antd's tree reacts to a focus event from inside its list by scrolling to
  // its active node — against a list ref that is detached for exactly that commit, which
  // throws. Focusing from an effect moves it past the commit. (The focus event is also
  // stopped below, so the tree never treats renaming as navigation in the first place.)
  useEffect(() => {
    if (isEditing) {
      // Selecting the current name makes typing replace it, as renaming usually should.
      inputRef.current?.focus({ cursor: "all" });
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        style={style}
        size="small"
        defaultValue={editableValue}
        placeholder={placeholder}
        onClick={(event) => event.stopPropagation()}
        // Renaming is not tree navigation; keep both events inside the input (see above).
        onFocus={(event) => event.stopPropagation()}
        // Enter commits by blurring, so that saving has exactly one code path.
        onPressEnter={() => inputRef.current?.blur()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.value = editableValue;
            inputRef.current?.blur();
          }
        }}
        onBlur={(event) => {
          const newName = event.target.value.trim();
          if (newName !== editableValue) {
            onCommit(newName);
          }
          onFinishEditing();
        }}
      />
    );
  }

  return (
    <Typography.Text
      ellipsis={ellipsis}
      strong={strong}
      style={style}
      title={title}
      onClick={onClick}
      onDoubleClick={() => {
        if (!disableEditing) {
          onStartEditing();
        }
      }}
    >
      {displayedName}
    </Typography.Text>
  );
}
