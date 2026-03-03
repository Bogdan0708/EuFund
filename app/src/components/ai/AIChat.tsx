'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { csrfFetch } from '@/lib/csrf/client';

function renderWithCitations(text: string): ReactNode {
  const parts = text.split(/(\[Sursa \d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[Sursa (\d+)\]$/);
    if (match) {
      return (
        <span
          key={i}
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 mx-0.5"
          title={`Sursa ${match[1]}`}
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Bună! Sunt asistentul dumneavoastră pentru fonduri europene. Pot să vă ajut cu:\n\n• Informații despre programe de finanțare\n• Întrebări despre eligibilitate\n• Cerințe de conformitate\n• Sfaturi pentru scrierea propunerilor\n\nCu ce vă pot ajuta?',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: 'user', content: input.trim(), timestamp: new Date() };
    const history = [...messages, userMessage].map(({ role, content }) => ({ role, content }));
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await csrfFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          history,
          locale: 'ro',
        }),
      });

      const data = await res.json();
      const assistantContent = data.success
        ? data.data.answer || 'Nu am putut genera un răspuns în acest moment.'
        : 'Îmi pare rău, a apărut o eroare. Vă rugăm să încercați din nou.';

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: assistantContent, timestamp: new Date() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Îmi pare rău, serviciul nu este disponibil momentan. Vă rugăm să încercați mai târziu.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] bg-white rounded-lg shadow">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold text-gray-900">🤖 Asistent AI Fonduri UE</h2>
        <p className="text-sm text-gray-500">Întrebați orice despre fondurile europene</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg p-3 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-800'
            }`}>
              <p className="whitespace-pre-wrap text-sm">
                {renderWithCitations(msg.content)}
              </p>
              <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                {msg.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg p-3">
              <div className="flex gap-1">
                <span className="animate-bounce text-gray-400">●</span>
                <span className="animate-bounce text-gray-400" style={{ animationDelay: '0.1s' }}>●</span>
                <span className="animate-bounce text-gray-400" style={{ animationDelay: '0.2s' }}>●</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Scrieți întrebarea dumneavoastră..."
            className="flex-1 border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="bg-blue-600 text-white px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            Trimite
          </button>
        </div>
      </div>
    </div>
  );
}
