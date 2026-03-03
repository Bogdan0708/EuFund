'use client';

import { useRef, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { type UIMessage, TextStreamChatTransport } from 'ai';
import { csrfHeaders } from '@/lib/csrf/client';
import { useTranslations } from 'next-intl';

// ─── Types ────────────────────────────────────────────────────────

interface UserOrg {
  id: string;
  name: string;
  type: string | null;
  sector: string | null;
}

interface ConversationalWizardProps {
  userOrgs: UserOrg[];
  initialIdea?: string;
  initialCallId?: string;
  locale: string;
}

// ─── Tool result type helpers ─────────────────────────────────────

interface EnhanceResult {
  enhancedIdea: string;
  suggestions: string[];
  structuredSummary: string;
  originalIdea: string;
}

interface FundingMatch {
  callId: string;
  callCode: string;
  title: string;
  programName: string;
  overallScore: number;
  eligibilityScore: number;
  relevanceScore: number;
  matchReason: string;
  recommendations: string[];
  budgetMin?: number;
  budgetMax?: number;
  submissionEnd?: string;
}

interface SearchResult {
  matches: FundingMatch[];
  totalFound: number;
}

interface SaveResult {
  projectId: string;
  title: string;
  message: string;
}

// ─── Component ────────────────────────────────────────────────────

export default function ConversationalWizard({
  userOrgs,
  initialIdea,
  initialCallId,
  locale,
}: ConversationalWizardProps) {
  const t = useTranslations('conversationalWizard');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState(initialIdea ?? '');

  const initialMessages: UIMessage[] = [
    {
      id: 'welcome',
      role: 'assistant',
      parts: [{ type: 'text' as const, text: t('welcome') }],
    },
  ];

  const { messages, sendMessage, status, error } = useChat({
    id: 'wizard-chat',
    transport: new TextStreamChatTransport({
      api: '/api/ai/wizard/chat',
      headers: () => csrfHeaders({ 'Content-Type': 'application/json' }),
      body: {
        locale,
        userOrgs: userOrgs.map((o) => ({ id: o.id, name: o.name, type: o.type })),
      },
    }),
    messages: initialMessages,
    onError: (err) => {
      console.error('[ConversationalWizard] Error:', err);
    },
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send initial message if idea or callId provided
  useEffect(() => {
    if (messages.length !== 1) return;
    if (initialIdea && initialCallId) {
      const text = locale === 'ro'
        ? `${initialIdea}\n\nVreau să generez o propunere pentru apelul cu ID: ${initialCallId}`
        : `${initialIdea}\n\nI want to generate a proposal for call ID: ${initialCallId}`;
      sendMessage({ text });
      setInputValue('');
    } else if (initialIdea) {
      sendMessage({ text: initialIdea });
      setInputValue('');
    } else if (initialCallId) {
      const text = locale === 'ro'
        ? `Vreau să generez o propunere pentru apelul cu ID: ${initialCallId}`
        : `I want to generate a proposal for call ID: ${initialCallId}`;
      sendMessage({ text });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setInputValue('');
    inputRef.current?.focus();
  };

  const handleQuickAction = (text: string) => {
    if (isLoading) return;
    sendMessage({ text });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] bg-white rounded-xl shadow-lg border border-gray-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-xl">
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <p className="text-sm text-gray-500">{t('subtitle')}</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} locale={locale} userOrgs={userOrgs} onAction={handleQuickAction} />
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-3">
              <div className="flex gap-1">
                <span className="animate-bounce text-gray-400">●</span>
                <span className="animate-bounce text-gray-400" style={{ animationDelay: '0.1s' }}>●</span>
                <span className="animate-bounce text-gray-400" style={{ animationDelay: '0.2s' }}>●</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {t('errorMessage')}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions */}
      <div className="px-4 pb-2 flex gap-2 flex-wrap">
        <QuickButton onClick={() => handleQuickAction(t('quickFindFunding'))} disabled={isLoading}>
          {t('quickFindFunding')}
        </QuickButton>
        <QuickButton onClick={() => handleQuickAction(t('quickGenerateProposal'))} disabled={isLoading}>
          {t('quickGenerateProposal')}
        </QuickButton>
        <QuickButton onClick={() => handleQuickAction(t('quickCheckEligibility'))} disabled={isLoading}>
          {t('quickCheckEligibility')}
        </QuickButton>
      </div>

      {/* Input */}
      <div className="px-4 pb-4 border-t border-gray-100 pt-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('placeholder')}
            className="flex-1 border border-gray-300 rounded-lg px-4 py-3 resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()}
            className="bg-blue-600 text-white px-5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {t('send')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────

function MessageBubble({
  message,
  locale,
  userOrgs,
  onAction,
}: {
  message: UIMessage;
  locale: string;
  userOrgs: UserOrg[];
  onAction: (text: string) => void;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? '' : 'w-full max-w-[85%]'}`}>
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            if (!part.text) return null;
            return (
              <div
                key={i}
                className={`rounded-lg px-4 py-3 ${
                  isUser
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 text-gray-800 border border-gray-200'
                }`}
              >
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  <CitationRenderer text={part.text} />
                </div>
              </div>
            );
          }

          // Tool invocation parts - render rich cards
          if ('toolCallId' in part && 'state' in part) {
            return (
              <ToolResultCard
                key={i}
                part={part}
                locale={locale}
                userOrgs={userOrgs}
                onAction={onAction}
              />
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

// ─── Tool result cards ────────────────────────────────────────────

function ToolResultCard({
  part,
  locale,
  userOrgs,
  onAction,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part: any;
  locale: string;
  userOrgs: UserOrg[];
  onAction: (text: string) => void;
}) {
  const t = useTranslations('conversationalWizard');
  const toolType = part.type?.replace('tool-', '') ?? '';

  if (part.state === 'input-streaming' || part.state === 'call') {
    return (
      <div className="my-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
        {toolType === 'enhance_idea' && t('toolEnhancing')}
        {toolType === 'search_funding_calls' && t('toolSearching')}
        {toolType === 'generate_proposal' && t('toolGenerating')}
        {toolType === 'save_project' && t('toolSaving')}
        <span className="ml-2 animate-pulse">...</span>
      </div>
    );
  }

  if (part.state !== 'result' || !part.output) return null;

  const output = part.output;

  if (toolType === 'enhance_idea') {
    const data = output as EnhanceResult;
    return <EnhanceCard data={data} />;
  }

  if (toolType === 'search_funding_calls') {
    const data = output as SearchResult;
    return <MatchesCard data={data} locale={locale} onAction={onAction} />;
  }

  if (toolType === 'generate_proposal') {
    return <ProposalCard data={output} />;
  }

  if (toolType === 'save_project') {
    const data = output as SaveResult;
    return <SaveCard data={data} locale={locale} userOrgs={userOrgs} />;
  }

  return null;
}

// ─── Enhance card ─────────────────────────────────────────────────

function EnhanceCard({ data }: { data: EnhanceResult }) {
  const t = useTranslations('conversationalWizard');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 bg-green-50 border border-green-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <span className="font-medium text-green-800 text-sm">{t('enhancedIdea')}</span>
        <span className="text-green-600 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{data.enhancedIdea}</div>
          {data.suggestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1">{t('suggestions')}</p>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                {data.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Matches card ─────────────────────────────────────────────────

function MatchesCard({
  data,
  locale,
  onAction,
}: {
  data: SearchResult;
  locale: string;
  onAction: (text: string) => void;
}) {
  const t = useTranslations('conversationalWizard');

  if (data.matches.length === 0) {
    return (
      <div className="my-2 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-700">
        {t('noMatches')}
      </div>
    );
  }

  return (
    <div className="my-2 space-y-2">
      <p className="text-xs font-semibold text-gray-500 px-1">
        {t('matchesFound', { count: data.totalFound })}
      </p>
      {data.matches.map((match) => (
        <div key={match.callId} className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-indigo-900 truncate">{match.title}</p>
              <p className="text-xs text-indigo-600 mt-0.5">{match.callCode} — {match.programName}</p>
            </div>
            <div className="flex-shrink-0 bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded">
              {match.overallScore}%
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-2">{match.matchReason}</p>
          <div className="flex gap-3 mt-2 text-xs text-gray-500">
            <span>{t('eligibility')}: {match.eligibilityScore}%</span>
            <span>{t('relevance')}: {match.relevanceScore}%</span>
            {match.submissionEnd && (
              <span>{t('deadline')}: {new Date(match.submissionEnd).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-US')}</span>
            )}
          </div>
          <button
            onClick={() => onAction(
              locale === 'ro'
                ? `Vreau să generez o propunere pentru apelul "${match.title}" (${match.callId})`
                : `I want to generate a proposal for call "${match.title}" (${match.callId})`
            )}
            className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
          >
            {t('selectCall')} →
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Proposal card ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ProposalCard({ data }: { data: any }) {
  const t = useTranslations('conversationalWizard');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['summary']));

  const proposal = data.proposal;
  if (!proposal) return null;

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const sections = [
    { key: 'summary', label: t('proposalSummary'), content: proposal.summary },
    { key: 'objectives', label: t('proposalObjectives'), content: proposal.objectives?.general },
    { key: 'methodology', label: t('proposalMethodology'), content: proposal.methodology?.approach },
    { key: 'budget', label: t('proposalBudget'), content: proposal.budget?.summary },
    { key: 'sustainability', label: t('proposalSustainability'), content: proposal.sustainability },
  ];

  return (
    <div className="my-2 bg-purple-50 border border-purple-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-purple-200">
        <p className="font-semibold text-purple-900 text-sm">{proposal.title}</p>
        {proposal.acronym && (
          <p className="text-xs text-purple-600">({proposal.acronym})</p>
        )}
      </div>
      <div className="divide-y divide-purple-100">
        {sections.map((section) => (
          <div key={section.key}>
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-purple-100/50"
            >
              <span className="text-xs font-medium text-purple-800">{section.label}</span>
              <span className="text-purple-500 text-xs">{expandedSections.has(section.key) ? '▲' : '▼'}</span>
            </button>
            {expandedSections.has(section.key) && section.content && (
              <div className="px-4 pb-3 text-sm text-gray-700 whitespace-pre-wrap">
                {section.content}
              </div>
            )}
          </div>
        ))}
      </div>
      {data.factCheck && (
        <div className="px-4 py-2 bg-purple-100/50 text-xs text-purple-600">
          {t('confidence')}: {Math.round(data.factCheck.confidenceScore * 100)}%
        </div>
      )}
    </div>
  );
}

// ─── Save success card ────────────────────────────────────────────

function SaveCard({
  data,
  locale,
}: {
  data: SaveResult;
  locale: string;
  userOrgs: UserOrg[];
}) {
  const t = useTranslations('conversationalWizard');

  return (
    <div className="my-2 bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-emerald-600 text-lg">✓</span>
        <span className="font-semibold text-emerald-800 text-sm">{t('projectSaved')}</span>
      </div>
      <p className="text-sm text-gray-700">{data.message}</p>
      <a
        href={`/${locale}/proiecte/${data.projectId}`}
        className="inline-block mt-3 text-sm font-semibold text-emerald-700 hover:text-emerald-900"
      >
        {t('goToProject')} →
      </a>
    </div>
  );
}

// ─── Citation renderer ────────────────────────────────────────────

function CitationRenderer({ text }: { text: string }) {
  // Parse [Sursa N] citations and render as styled badges
  const parts = text.split(/(\[Sursa \d+\])/g);

  return (
    <>
      {parts.map((part, i) => {
        const citationMatch = part.match(/^\[Sursa (\d+)\]$/);
        if (citationMatch) {
          return (
            <span
              key={i}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 mx-0.5"
              title={`Sursa ${citationMatch[1]}`}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ─── Quick action button ──────────────────────────────────────────

function QuickButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
