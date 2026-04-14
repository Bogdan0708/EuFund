'use client'

import { parseMarkdownBlocks, type Block, type InlineRun } from '@/lib/markdown/proposal-markdown'

function InlineRuns({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, i) => {
        if (run.type === 'bold') {
          return <strong key={i} className="font-semibold text-on-surface">{run.content}</strong>
        }
        return <span key={i}>{run.content}</span>
      })}
    </>
  )
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      if (block.level === 2) {
        return (
          <h3 className="text-base font-semibold text-on-surface mt-4 mb-1.5">
            <InlineRuns runs={block.runs} />
          </h3>
        )
      }
      return (
        <h4 className="text-sm font-semibold text-on-surface mt-3 mb-1">
          <InlineRuns runs={block.runs} />
        </h4>
      )

    case 'bullet_list':
      return (
        <ul className="list-disc list-outside ml-5 my-2 space-y-1">
          {block.items.map((item, i) => (
            <li key={i} className="text-sm text-on-surface-variant leading-relaxed">
              <InlineRuns runs={item.runs} />
            </li>
          ))}
        </ul>
      )

    case 'numbered_list':
      return (
        <ol className="list-decimal list-outside ml-5 my-2 space-y-1">
          {block.items.map((item, i) => (
            <li key={i} className="text-sm text-on-surface-variant leading-relaxed">
              <InlineRuns runs={item.runs} />
            </li>
          ))}
        </ol>
      )

    case 'paragraph':
      return (
        <p className="text-sm text-on-surface-variant leading-relaxed my-1.5">
          <InlineRuns runs={block.runs} />
        </p>
      )
  }
}

export function MarkdownPreview({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content)

  return (
    <div className="space-y-0">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  )
}
