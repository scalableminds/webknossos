type $npm$classnames$Classes = string | { [className: string]: * } | false | void | null;

function classnames(...classes: Array<$npm$classnames$Classes | $npm$classnames$Classes[]>): string;
type classnames = typeof classnames

declare module "classnames" {
  export default classnames;
}

declare module "classnames/bind" {
  export default classnames;
}

declare module "classnames/dedupe" {
  export default classnames;
}
