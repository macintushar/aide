import type { AnchorHTMLAttributes } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Message text as Markdown. Raw HTML is not rendered (react-markdown escapes
 * it by default), so a model cannot inject markup. Links that point at a file
 * in the session (a relative path, which is what the composer's `@` picker
 * inserts) open a preview instead of navigating the app away.
 */

export function isFileLink(href: string | undefined): href is string {
  if (!href) return false
  if (href.startsWith("#")) return false
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//")
}

function fileLinkPath(href: string): string {
  const bare = href.replace(/^<|>$/g, "").split("#")[0]!
  try {
    return decodeURIComponent(bare)
  } catch {
    return bare
  }
}

export function Markdown({
  text,
  onOpenFile,
}: {
  text: string
  onOpenFile?: (path: string) => void
}) {
  const components: Components = {
    a({ href, children, node: _node, ...rest }) {
      if (isFileLink(href) && onOpenFile) {
        const path = fileLinkPath(href)
        return (
          <button
            type="button"
            title={`Preview ${path}`}
            onClick={() => onOpenFile(path)}
            className="cursor-pointer text-accent-ink underline decoration-dotted underline-offset-2"
          >
            {children}
          </button>
        )
      }
      return (
        <a
          {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent-ink underline underline-offset-2"
        >
          {children}
        </a>
      )
    },
    p: ({ children }) => (
      <p className="my-2 first:mt-0 last:mb-0">{children}</p>
    ),
    ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
    ol: ({ children }) => (
      <ol className="my-2 list-decimal pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="my-0.5">{children}</li>,
    h1: ({ children }) => (
      <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>
    ),
    h2: ({ children }) => (
      <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>
    ),
    h3: ({ children }) => (
      <h4 className="mt-3 mb-1 font-semibold">{children}</h4>
    ),
    h4: ({ children }) => (
      <h4 className="mt-2 mb-1 font-semibold">{children}</h4>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    pre: ({ children }) => (
      <pre className="my-2 overflow-auto rounded-xl bg-muted/60 p-3 font-mono text-xs">
        {children}
      </pre>
    ),
    code: ({ className, children }) =>
      className ? (
        <code className={className}>{children}</code>
      ) : (
        <code className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.85em]">
          {children}
        </code>
      ),
    table: ({ children }) => (
      <div className="my-2 overflow-auto">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-border px-2 py-1 text-left font-medium">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-border px-2 py-1">{children}</td>
    ),
    hr: () => <hr className="my-3 border-border" />,
  }

  return (
    <div className="text-sm break-words" data-testid="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
