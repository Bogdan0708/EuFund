'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MarkdownRenderProps {
  content: string;
  className?: string;
}

export function MarkdownRender({ content, className }: MarkdownRenderProps) {
  return (
    <div className={`prose prose-sm max-w-none text-on-surface-variant ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-on-surface mt-4 mb-1.5">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-on-surface mt-3 mb-1">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-sm text-on-surface-variant leading-relaxed my-1.5">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-5 my-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside ml-5 my-2 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm text-on-surface-variant leading-relaxed">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-on-surface">{children}</strong>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-sm border border-outline-variant/20">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-outline-variant/20 px-3 py-1.5 bg-surface-container text-left font-semibold text-on-surface">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-outline-variant/20 px-3 py-1.5">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
