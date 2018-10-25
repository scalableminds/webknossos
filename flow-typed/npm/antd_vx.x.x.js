declare module "antd" {
  declare class Alert<P> extends React$Component<P> {}
  declare class Avatar<P> extends React$Component<P> {}
  declare class Button<P> extends React$Component<P> {
    static Group: React$ComponentType<P>;
  }
  declare class Card<P> extends React$Component<P> {}
  declare class Checkbox<P> extends React$Component<P> {}
  declare class Col<P> extends React$Component<P> {}
  declare class Collapse<P> extends React$Component<P> {
    static Panel: React$ComponentType<P>;
  }
  declare class DatePicker<P> extends React$Component<P> {
    static RangePicker: React$ComponentType<P>;
  }
  declare class Divider<P> extends React$Component<P> {}
  declare class Dropdown<P> extends React$Component<P> {}
  declare class Icon<P> extends React$Component<P> {}
  declare class Input<P> extends React$Component<P> {
    static Group: React$ComponentType<P>;
    static Search: React$ComponentType<P>;
    static TextArea: React$ComponentType<P>;
    focus: () => void;
  }
  declare class InputNumber<P> extends React$Component<P> {
    focus: () => void;
  }
  declare class Form<P> extends React$Component<P> {
    static create: (
      options?: Object,
    ) => (React$ComponentType<P>) => React$ComponentType<$Diff<P, { form: any }>>;
    static Item: React$ComponentType<P>;
  }
  declare class Layout<P> extends React$Component<P> {
    static Content: React$ComponentType<P>;
    static Footer: React$ComponentType<P>;
    static Header: React$ComponentType<P>;
    static Sider: React$ComponentType<P>;
  }
  declare class Meta<P> extends React$Component<P> {}
  declare class ListItem<P> extends React$Component<P> {
    static Meta: typeof Meta;
  }
  declare class List<P> extends React$Component<P> {
    static Item: typeof ListItem;
  }
  declare class Menu<P> extends React$Component<P> {
    static Item: React$ComponentType<P>;
    static SubMenu: React$ComponentType<P>;
    static Divider: React$ComponentType<P>;
    static ItemGroup: React$ComponentType<P>;
  }
  declare var message: Object;
  declare class Modal<P> extends React$Component<P> {
    static confirm: Function;
    static info: Function;
  }
  declare var notification: Object;
  declare class Pagination<P> extends React$Component<P> {}
  declare class Popover<P> extends React$Component<P> {}
  declare class AutoComplete<P> extends React$Component<P> {
    static Option: React$ComponentType<*>;
    blur: () => void;
  }
  declare class Progress<P> extends React$Component<P> {}
  declare class Radio<P> extends React$Component<P> {
    static Button: React$ComponentType<P>;
    static Group: React$ComponentType<P>;
  }
  declare class Row<P> extends React$Component<P> {}
  declare class Select<P> extends React$Component<P> {
    static Option: React$ComponentType<*>;
  }
  declare class Slider<P> extends React$Component<P> {}
  declare class Spin<P> extends React$Component<P> {}
  declare class Switch<P> extends React$Component<P> {}
  declare class Table<P> extends React$Component<P> {
    static Column: React$ComponentType<P>;
    static ColumnGroup: React$ComponentType<P>;
  }
  declare class Tabs<P> extends React$Component<P> {
    static TabPane: React$ComponentType<P>;
  }
  declare class Tag<P> extends React$Component<P> {}
  declare class Tree<P> extends React$Component<P> {
    static TreeNode: React$ComponentType<P>;
  }
  declare class Tooltip<P> extends React$Component<P> {}
  declare class Steps<P> extends React$Component<P> {
    static Step: React$ComponentType<P>;
  }
  declare class Upload<P> extends React$Component<P> {
    static Dragger: React$ComponentType<P>;
  }
  declare class Popconfirm<P> extends React$Component<P> {}
  declare class Badge<P> extends React$Component<P> {}
}
