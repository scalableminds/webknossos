React      = require("react")
ReactDOM   = require("react-dom")
Utils      = require("libs/utils")


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


CommentList = React.createClass(

  render : ->

    activeNodeId = @state.activeNodeId

    commentNodes = @state.data.map( (comment) =>

      nodeId = comment.get("node")
      return (
        <Comment
          key={nodeId}
          model={comment}
          isActive={nodeId == activeNodeId}
          onNewActiveNode={@props.onNewActiveNode}
        />
      )
    )

    return (
      <div className="commentList">
        {commentNodes}
      </div>
    )


  getInitialState : ->

    return {
      data : []
      activeNodeId : 0
    }
)

module.exports = CommentList
