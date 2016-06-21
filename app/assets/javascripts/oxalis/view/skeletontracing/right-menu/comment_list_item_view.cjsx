React       = require("react")
ReactDOM    = require("react-dom")


Comment = React.createClass(

  render : ->

    data = @props.model.attributes
    return (
      <li>
        <i className={"fa " + "fa-angle-right" if @props.isActive}></i>
        <a href="#" onClick={@handleClick} >{data.node + " - " + data.content}</a>
      </li>
    )


  handleClick : ->

    @props.onNewActiveNode(@props.model)


  componentDidUpdate : ->

    @ensureVisible()


  ensureVisible : ->

    el = ReactDOM.findDOMNode(@)
    if @props.isActive
      el.scrollIntoViewIfNeeded()

)

module.exports = Comment
