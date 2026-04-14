'use client';

import dynamic from 'next/dynamic';

const MDXEditor = dynamic(
  () => import('@mdxeditor/editor').then((mod) => {
    const {
      MDXEditor,
      headingsPlugin,
      listsPlugin,
      quotePlugin,
      thematicBreakPlugin,
      linkPlugin,
      toolbarPlugin,
      BoldItalicUnderlineToggles,
      BlockTypeSelect,
      ListsToggle,
      CreateLink,
    } = mod;

    function EditorInner({ markdown, onChange, readOnly }: { markdown: string; onChange: (md: string) => void; readOnly?: boolean }) {
      return (
        <MDXEditor
          markdown={markdown}
          onChange={onChange}
          readOnly={readOnly}
          contentEditableClassName="prose prose-sm max-w-none min-h-[400px] p-4 text-on-surface-variant focus:outline-none"
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            ...(readOnly ? [] : [toolbarPlugin({
              toolbarContents: () => (
                <>
                  <BlockTypeSelect />
                  <BoldItalicUnderlineToggles />
                  <ListsToggle />
                  <CreateLink />
                </>
              ),
            })]),
          ]}
        />
      );
    }

    EditorInner.displayName = 'MDXEditorInner';
    return EditorInner;
  }),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse bg-surface-container rounded-xl min-h-[400px]" />
    ),
  },
);

interface SectionEditorProps {
  value: string;
  onChange: (md: string) => void;
  readOnly?: boolean;
  editorKey?: string | number;
}

export function SectionEditor({ value, onChange, readOnly, editorKey }: SectionEditorProps) {
  return (
    <div className="border border-outline-variant/20 rounded-xl overflow-hidden bg-surface">
      <MDXEditor key={editorKey} markdown={value} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
