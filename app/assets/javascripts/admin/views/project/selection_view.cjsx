React = require("react")
_     = require("lodash")
{ FormControl } = require("react-bootstrap")

class SelectionView extends React.Component

  constructor : ->
    super
    this.state = {
      collection: new this.props.collectionType()
    }
    this.state.collection.fetch(this.props.collectionOptions)
    this._forceUpdate = => this.forceUpdate()

  componentDidMount : ->
    this.state.collection.on("all", this._forceUpdate)
    @changeToDefaultItem()

  componentWillReceiveProps : (newProps) ->
    if this.props.collectionType != newProps.collectionType
      throw new Error("Not supported: collectionType cannot change.")

  componentWillUnmount : ->
    this.state.collection.off("all", this._forceUpdate)

  componentDidUpdate : ->
    # TODO:
    # if right after sync
    #   @changeToDefaultItem()

  changeToDefaultItem : ->
    if this.props.defaultItem and this.state.collection.any(this.props.defaultItem)
      item = this.state.collection.find(this.props.defaultItem)
      value = this.props.valueExtractor(item)
      if this.props.value != value
        this.props.onChange({ target: { value }})

  render : ->
    { valueExtractor = _.identity, labelExtractor = null } = this.props
    props = _.omit(this.props, ["collectionType", "collectionOptions", "valueExtractor", "labelExtractor", "defaultItem"])
    if labelExtractor == null
      labelExtractor = valueExtractor
    return (
      <FormControl componentClass="select" {...props}>
        <option disabled>Please select</option>
        {
          this.state.collection.map((item, i) -> <option key={i} value={valueExtractor(item)}>{labelExtractor(item)}</option>)
        }
      </FormControl>
    )

module.exports = SelectionView
