// @flow

type MessageConfig = {
  content?: string | React$Node,
  key?: string,
  duration?: number,
  onClose?: Function,
};
type MessageContent = string | React$Node | MessageConfig;

declare module "antd" {
  declare export class Alert<P> extends React$Component<P> {}
  declare export class AutoComplete<P> extends React$Component<P> {
    static Option: React$ComponentType<*>;
    blur: () => void;
  }
  declare export class Avatar<P> extends React$Component<P> {}
  declare class ButtonGroup<P> extends React$Component<P> {}
  declare export class Button<P> extends React$Component<P> {
    static Group: typeof ButtonGroup;
  }
  declare export class Card<P> extends React$Component<P> {}
  declare export class Checkbox<P> extends React$Component<P> {}
  declare export class Col<P> extends React$Component<P> {}
  declare class CollapsePanel<P> extends React$Component<P> {}
  declare export class Collapse<P> extends React$Component<P> {
    static Panel: typeof CollapsePanel;
  }
  declare class DatePickerRangePicker<P> extends React$Component<P> {}
  declare export class DatePicker<P> extends React$Component<P> {
    static RangePicker: typeof DatePickerRangePicker;
  }
  declare export class Divider<P> extends React$Component<P> {}
  declare export class Dropdown<P> extends React$Component<P> {}
  declare export class Empty<P> extends React$Component<P> {
    static PRESENTED_IMAGE_SIMPLE: string;
  }
  declare export class Icon<P> extends React$Component<P> {}
  declare class InputGroup<P> extends React$Component<P> {}
  declare class InputPassword<P> extends React$Component<P> {}
  declare class InputSearch<P> extends React$Component<P> {}
  declare class InputTextArea<P> extends React$Component<P> {}
  declare export class Input<P> extends React$Component<P> {
    static Group: typeof InputGroup;
    static Password: typeof InputPassword;
    static Search: typeof InputSearch;
    static TextArea: typeof InputTextArea;
    focus: () => void;
  }
  declare export class InputNumber<P> extends React$Component<P> {
    focus: () => void;
  }
  declare class FormItem<P> extends React$Component<P> {}
  declare export class Form<P> extends React$Component<P> {
    static useForm: () => [Object];
    static Item: typeof FormItem;
  }
  declare class LayoutContent<P> extends React$Component<P> {}
  declare class LayoutHeader<P> extends React$Component<P> {}
  declare class LayoutFooter<P> extends React$Component<P> {}
  declare class LayoutSider<P> extends React$Component<P> {}
  declare export class Layout<P> extends React$Component<P> {
    static Content: typeof LayoutContent;
    static Footer: typeof LayoutFooter;
    static Header: typeof LayoutHeader;
    static Sider: typeof LayoutSider;
  }
  declare class ListItem<P> extends React$Component<P> {
    static Meta: typeof ListItemMeta;
  }
  declare class ListItemMeta<P> extends React$Component<P> {}
  declare export class List<P> extends React$Component<P> {
    static Item: typeof ListItem;
  }
  declare class MenuDivider<P> extends React$Component<P> {}
  declare class MenuItem<P> extends React$Component<P> {}
  declare class MenuItemGroup<P> extends React$Component<P> {}
  declare class MenuSubMenu<P> extends React$Component<P> {}
  declare export class Menu<P> extends React$Component<P> {
    static Divider: typeof MenuDivider;
    static Item: typeof MenuItem;
    static ItemGroup: typeof MenuItemGroup;
    static SubMenu: typeof MenuSubMenu;
  }

  declare export var message: {
    success(content: MessageContent, duration?: number, onClose?: Function): Function,
    error(content: MessageContent, duration?: number, onClose?: Function): Function,
    info(content: MessageContent, duration?: number, onClose?: Function): Function,
    warning(content: MessageContent, duration?: number, onClose?: Function): Function,
    warn(content: MessageContent, duration?: number, onClose?: Function): Function,
    loading(content: MessageContent, duration?: number, onClose?: Function): Function,
    destroy(key: string): Function,
  };
  declare export class Modal<P> extends React$Component<P> {
    static confirm: Function;
    static info: Function;
    static error: Function;
  }
  declare export var notification: Object;
  declare export class Pagination<P> extends React$Component<P> {}
  declare export class Popover<P> extends React$Component<P> {}
  declare export class Progress<P> extends React$Component<P> {}
  declare class RadioButton<P> extends React$Component<P> {}
  declare class RadioGroup<P> extends React$Component<P> {}
  declare export class Radio<P> extends React$Component<P> {
    static Button: typeof RadioButton;
    static Group: typeof RadioGroup;
  }
  declare export class Row<P> extends React$Component<P> {}
  declare class SelectOption<P> extends React$Component<P> {}
  declare class SelectOptGroup<P> extends React$Component<P> {}
  declare export class Select<P> extends React$Component<P> {
    static Option: typeof SelectOption;
    static OptGroup: typeof SelectOptGroup;
  }
  declare export class Result<P> extends React$Component<P> {}
  declare export class Slider<P> extends React$Component<P> {}
  declare export class Spin<P> extends React$Component<P> {}
  declare export class Switch<P> extends React$Component<P> {}
  declare class TableColumn<P> extends React$Component<P> {}
  declare class TableColumnGroup<P> extends React$Component<P> {}
  declare export class Table<P> extends React$Component<P> {
    static Column: typeof TableColumn;
    static ColumnGroup: typeof TableColumnGroup;
  }
  declare class TabsTabPane<P> extends React$Component<P> {}
  declare export class Tabs<P> extends React$Component<P> {
    static TabPane: typeof TabsTabPane;
  }
  declare export class Tag<P> extends React$Component<P> {}
  declare class TreeTreeNode<P> extends React$Component<P> {}
  declare export class Tree<P> extends React$Component<P> {
    static TreeNode: typeof TreeTreeNode;
  }
  declare export class Tooltip<P> extends React$Component<P> {}
  declare export class Space<P> extends React$Component<P> {}
  declare class StepsStep<P> extends React$Component<P> {}
  declare export class Steps<P> extends React$Component<P> {
    static Step: typeof StepsStep;
  }
  declare class UploadDragger<P> extends React$Component<P> {}
  declare export class Upload<P> extends React$Component<P> {
    static Dragger: typeof UploadDragger;
  }
  declare export class Popconfirm<P> extends React$Component<P> {}
  declare export class Badge<P> extends React$Component<P> {}
}
