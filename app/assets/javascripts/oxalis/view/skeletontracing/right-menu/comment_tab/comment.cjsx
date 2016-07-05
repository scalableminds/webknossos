React                  = require("react")
ReactDOM               = require("react-dom")
scrollIntoViewIfNeeded = require("scroll-into-view-if-needed")


Comment = React.createClass(

  render : ->

    data = @props.data
    return (
      <li className={if @props.isActive then "bold" else ""}>
        <i className={"fa fa-fw " + "fa-angle-right" if @props.isActive}></i>
        <a href="#" onClick={@handleClick} >{data.node + " - " + data.content}</a>
      </li>
    )


  handleClick : ->

    @props.onNewActiveNode(@props.data, @props.treeId)


  componentDidUpdate : ->

    @ensureVisible()


  ensureVisible : ->

    el = ReactDOM.findDOMNode(@)
    if @props.isActive
      # use ponyfill as so far only chrome supports this functionality
      scrollIntoViewIfNeeded(el)

)

module.exports = Comment
