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
            className="cursor-pointer font-mono text-[0.875em] text-accent-ink underline decoration-[var(--accent-dim)] decoration-dotted underline-offset-3 hover:decoration-solid"
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
          className="text-accent-ink underline decoration-[var(--accent-dim)] underline-offset-3 hover:decoration-[var(--accent-base)]"
        >
          {children}
        </a>
      )
    },
    p: ({ children }) => (
      <p className="my-2.5 first:mt-0 last:mb-0">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="my-2.5 list-disc pl-5 marker:text-[var(--n5)]">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2.5 list-decimal pl-5 marker:text-[var(--n5)]">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="my-1 pl-0.5">{children}</li>,
    h1: ({ children }) => (
      <h3 className="mt-5 mb-2 text-h3 text-foreground">{children}</h3>
    ),
    h2: ({ children }) => (
      <h3 className="mt-5 mb-2 text-[1.0625rem] font-semibold tracking-[-0.01em] text-foreground">
        {children}
      </h3>
    ),
    h3: ({ children }) => (
      <h4 className="mt-4 mb-1.5 font-semibold text-foreground">{children}</h4>
    ),
    h4: ({ children }) => (
      <h4 className="mt-3 mb-1 font-semibold text-foreground">{children}</h4>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-[var(--accent-dim)] pl-3.5 text-muted-foreground">
        {children}
      </blockquote>
    ),
    pre: ({ children }) => (
      <pre className="my-3 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--n0)] px-4 py-3 font-mono text-mono text-[var(--n7)]">
        {children}
      </pre>
    ),
    code: ({ className, children }) =>
      className ? (
        <code className={className}>{children}</code>
      ) : (
        <code className="rounded-md border border-[var(--line)] bg-[var(--n2)] px-1.5 py-px font-mono text-[0.84em] text-[var(--n8)]">
          {children}
        </code>
      ),
    table: ({ children }) => (
      <div className="my-3 overflow-auto rounded-lg border border-[var(--line)]">
        <table className="w-full border-collapse text-ui">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-[var(--line)] bg-[var(--n2)] px-3 py-1.5 text-left font-medium">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-[var(--line)] px-3 py-1.5">{children}</td>
    ),
    hr: () => <hr className="my-4 border-[var(--line)]" />,
  }

  return (
    <div
      className="text-body leading-[1.7] break-words text-[var(--n8)] [&_strong]:font-semibold [&_strong]:text-foreground"
      data-testid="markdown"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
