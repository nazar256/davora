import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

export function MarkdownPreview({ content }: { content: string }) {
  const html = markdown.render(content);
  return (
    <div className="markdown-preview">
      <div className="rendered-markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <details>
        <summary>Show raw markdown</summary>
        <pre>{content}</pre>
      </details>
    </div>
  );
}
