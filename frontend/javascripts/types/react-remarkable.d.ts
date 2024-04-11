
declare module 'react-remarkable' {
    import type React from "react";
    
    type ReactRemarkableProps = {
        source: string,
        container?: string,
        options?: {
            html: boolean,
            breaks: boolean
            linkify: boolean
        }
        className?: string
        style?: React.CSSProperties
    }
    declare class Markdown extends React.Component<ReactRemarkableProps> {}
    export default Markdown
}

