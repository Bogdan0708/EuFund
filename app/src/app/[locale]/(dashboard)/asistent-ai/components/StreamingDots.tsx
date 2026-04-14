export function StreamingDots() {
  return (
    <div className="flex items-start max-w-[85%]">
      <div className="glass-card px-5 py-4 rounded-[1rem] rounded-tl-none shadow-[0_20px_40px_rgba(0,0,0,0.04)] border border-white/20">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}
