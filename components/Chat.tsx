"use client";

import { useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Summarise my startup this week.",
  "What changed yesterday?",
  "What should I focus on next?",
];

export function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      if (!res.ok || !res.body) throw new Error("chat failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            content: copy[copy.length - 1].content + chunk,
          };
          return copy;
        });
        endRef.current?.scrollIntoView({ block: "nearest" });
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content: "Something went wrong. Try again.",
        };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-16 border-t border-line pt-8" aria-label="Ask about your startup">
      <p className="eyebrow mb-4">Ask your brief</p>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="font-mono text-[12px] text-muted border border-line rounded-full px-3 py-1.5 hover:text-ink hover:border-muted transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {messages.map((m, i) => (
          <div key={i} className="text-[15px] leading-relaxed">
            {m.role === "user" ? (
              <p className="font-medium">{m.content}</p>
            ) : (
              <p className="text-muted whitespace-pre-wrap">
                {m.content || (busy && i === messages.length - 1 ? "…" : "")}
              </p>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your startup…"
          className="field"
          aria-label="Ask a question about your startup"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()} className="btn-ghost shrink-0">
          Ask
        </button>
      </form>
      <p className="text-[11px] text-faint mt-2">
        Answers use only your connected data. If it can&apos;t tell, it says so.
      </p>
    </section>
  );
}
