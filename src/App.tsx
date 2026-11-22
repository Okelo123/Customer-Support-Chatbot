import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  BookOpen,
  Bug,
  CheckCircle2,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  Wrench,
} from "lucide-react";
import type { BugReport, ChatMessage, ToolCallRecord } from "./types";

const STARTER_PROMPTS = [
  {
    label: "FAQ Question",
    prompt: "What is your return policy and how long do refunds take?",
  },
  {
    label: "Report a Bug",
    prompt: "The checkout button freezes when I try to pay for my cart.",
  },
  {
    label: "Human Handoff",
    prompt: "I was charged twice for order #48291 and need a billing adjustment.",
  },
];

export default function App() {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bugReports, setBugReports] = useState<BugReport[]>([]);
  const [faqContent, setFaqContent] = useState<string>("");
  const [faqSearch, setFaqSearch] = useState("");
  const [activeSideTab, setActiveSideTab] = useState<"bugs" | "faq">("bugs");
  const [mobileView, setMobileView] = useState<"chat" | "panel">("chat");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  async function fetchBugReports() {
    try {
      const res = await fetch("/api/bug-reports");
      if (!res.ok) return;
      const data = (await res.json()) as { reports: BugReport[] };
      setBugReports(data.reports ?? []);
    } catch {
      // Ignore background refresh failures
    }
  }

  async function fetchFaq() {
    try {
      const res = await fetch("/api/faq");
      if (!res.ok) return;
      const data = (await res.json()) as { content: string };
      setFaqContent(data.content ?? "");
    } catch {
      // Ignore FAQ load errors
    }
  }

  async function startNewConversation() {
    setError(null);
    try {
      const res = await fetch("/api/sessions/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { sessionId: string };
        setSessionId(data.sessionId);
      } else {
        setSessionId("");
      }
    } catch {
      setSessionId("");
    }
    setMessages([]);
  }

  useEffect(() => {
    void startNewConversation();
    void fetchBugReports();
    void fetchFaq();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setError(null);
    setInput("");

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: trimmed }),
      });

      const data = (await res.json()) as {
        sessionId?: string;
        reply?: string;
        toolCalls?: ToolCallRecord[];
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: data.reply || "",
        toolCalls: data.toolCalls,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (data.toolCalls && data.toolCalls.length > 0) {
        await fetchBugReports();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reach support agent."
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  async function toggleReportStatus(report: BugReport) {
    const nextStatus = report.status === "OPEN" ? "RESOLVED" : "OPEN";
    try {
      const res = await fetch(`/api/bug-reports/${report.ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        await fetchBugReports();
      }
    } catch {
      // Ignore toggle error
    }
  }

  const openBugCount = bugReports.filter((r) => r.status === "OPEN").length;

  const filteredFaqSections = faqContent
    .split(/\n⸻\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((section) =>
      faqSearch.trim()
        ? section.toLowerCase().includes(faqSearch.trim().toLowerCase())
        : true
    );

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
              Online Shop Support
            </h1>
            <p className="text-xs text-slate-500">
              FAQ grounding, bug report intake &amp; human handoff
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileView("chat")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                mobileView === "chat"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600"
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setMobileView("panel")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                mobileView === "panel"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600"
              }`}
            >
              Tickets ({bugReports.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => void startNewConversation()}
            disabled={isSending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            New Session
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_380px]">
        {/* Chat Column */}
        <section
          className={`flex min-h-0 flex-col bg-slate-50 ${
            mobileView === "panel" ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-xl flex-col justify-center">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                  <h2 className="text-base font-semibold text-slate-900">
                    How can we help today?
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-600">
                    Ask a question from our Online Shop FAQ, report a site bug
                    (we&apos;ll collect the description, steps to reproduce, and
                    your device/browser), or request human support.
                  </p>

                  <div className="mt-5 grid gap-2">
                    {STARTER_PROMPTS.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => void sendMessage(item.prompt)}
                        className="flex flex-col items-start rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-100"
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          {item.label}
                        </span>
                        <span className="mt-0.5 text-sm text-slate-800">
                          {item.prompt}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                    <PhoneCall className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Urgent account or billing dispute? Direct human support:
                      0743418889
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-2xl flex-col gap-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mb-2 flex w-full max-w-lg flex-col gap-2">
                        {msg.toolCalls.map((tc, idx) => {
                          const ticketId =
                            typeof tc.result.ticketId === "string"
                              ? tc.result.ticketId
                              : null;
                          const toolError =
                            typeof tc.result.error === "string"
                              ? tc.result.error
                              : null;

                          return (
                            <div
                              key={`${msg.id}-tool-${idx}`}
                              className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950"
                            >
                              <div className="flex items-center gap-1.5 font-mono font-medium">
                                <Wrench className="h-3.5 w-3.5 text-amber-700" />
                                <span>[tool call] {tc.name}</span>
                              </div>
                              {ticketId && (
                                <div className="mt-1 text-amber-900">
                                  Ticket filed:{" "}
                                  <span className="font-mono font-semibold">
                                    {ticketId}
                                  </span>{" "}
                                  (OPEN)
                                </div>
                              )}
                              {toolError && (
                                <div className="mt-1 text-red-700">
                                  {toolError}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-slate-900 text-white"
                          : "border border-slate-200 bg-white text-slate-800 shadow-xs"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}

                {isSending && (
                  <div className="flex items-start">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500 shadow-xs">
                      Thinking...
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-800 sm:mx-6">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Message Input */}
          <form
            onSubmit={handleSubmit}
            className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6"
          >
            <div className="mx-auto flex max-w-2xl items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question, describe a bug, or request support..."
                disabled={isSending}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
              />
              <button
                type="submit"
                disabled={isSending || !input.trim()}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </div>
          </form>
        </section>

        {/* Side Panel: Bug Reports & FAQ */}
        <aside
          className={`flex min-h-0 flex-col border-l border-slate-200 bg-white ${
            mobileView === "chat" ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="flex shrink-0 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActiveSideTab("bugs")}
              className={`flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-xs font-semibold transition ${
                activeSideTab === "bugs"
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Bug className="h-4 w-4" />
              <span>Bug Reports</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                {openBugCount} open
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSideTab("faq")}
              className={`flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-xs font-semibold transition ${
                activeSideTab === "faq"
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <BookOpen className="h-4 w-4" />
              <span>Shop FAQ</span>
            </button>
          </div>

          {activeSideTab === "bugs" ? (
            <div className="flex-1 overflow-y-auto p-4">
              {bugReports.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
                  <Bug className="mx-auto h-6 w-6 text-slate-400" />
                  <p className="mt-2 text-sm font-medium text-slate-700">
                    No bug tickets yet
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Report a bug in the chat and provide description, steps to
                    reproduce, and environment to file a ticket.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {bugReports.map((report) => (
                    <div
                      key={report.ticketId}
                      className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-[11px] text-slate-500">
                          {report.ticketId.slice(0, 8)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void toggleReportStatus(report)}
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold transition ${
                            report.status === "OPEN"
                              ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                              : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                          }`}
                        >
                          {report.status === "RESOLVED" && (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          {report.status}
                        </button>
                      </div>

                      <p className="mt-2 font-medium text-slate-900">
                        {report.description}
                      </p>

                      <div className="mt-2.5 space-y-1.5 border-t border-slate-200/80 pt-2 text-slate-600">
                        <div>
                          <span className="font-semibold text-slate-700">
                            Steps:{" "}
                          </span>
                          <span>{report.stepsToReproduce}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-700">
                            Env:{" "}
                          </span>
                          <span>{report.environment}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-slate-100 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={faqSearch}
                    onChange={(e) => setFaqSearch(e.target.value)}
                    placeholder="Filter FAQ..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs leading-relaxed text-slate-700">
                {filteredFaqSections.map((section, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 whitespace-pre-wrap"
                  >
                    {section}
                  </div>
                ))}
                {filteredFaqSections.length === 0 && (
                  <p className="text-center text-slate-400">
                    No matching FAQ sections.
                  </p>
                )}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
