import { useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/_index";
import BtnPrimary from "~/components/tabledeck/BtnPrimary";

export function meta() {
  return [
    { title: "The Game of Things — Tabledeck Edition" },
    {
      name: "description",
      content:
        "Host a table for The Game of Things. Share a link so everyone can follow the round.",
    },
  ];
}

export async function loader() {
  return {};
}

export default function Index(_: Route.ComponentProps) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [hostName, setHostName] = useState("");
  const [topic, setTopic] = useState("");
  const [hostNameError, setHostNameError] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const createGame = async () => {
    if (!hostName.trim()) {
      setHostNameError(true);
      document.getElementById("hostName")?.focus();
      return;
    }
    setHostNameError(false);
    setSubmitError("");
    setCreating(true);

    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostName: hostName.trim(),
          topic: topic.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setSubmitError(body.error ?? "Failed to create game.");
        setCreating(false);
        return;
      }
      const { gameId } = (await res.json()) as { gameId: string };
      navigate(`/game/${gameId}`);
    } catch {
      setSubmitError("Network error. Please try again.");
      setCreating(false);
    }
  };

  return (
    <div className="lobby">
      <a className="back-link" href="https://tabledeck.us">
        ← Tabledeck
      </a>

      <header className="lobby-hero">
        <h1>The Game of Things</h1>
        <div className="lobby-rule" aria-hidden="true" />
        <p className="lobby-kicker">Tabledeck Edition</p>
        <p className="lobby-tag">pick a prompt. pass it around.</p>
      </header>

      <form
        className="lobby-card"
        onSubmit={(e) => {
          e.preventDefault();
          void createGame();
        }}
      >
        <div className="lobby-body">
          <div style={{ marginBottom: 18 }}>
            <label className="field-label" htmlFor="hostName">
              Your name
            </label>
            <input
              id="hostName"
              type="text"
              value={hostName}
              onChange={(e) => {
                setHostName(e.target.value);
                if (e.target.value.trim()) setHostNameError(false);
              }}
              placeholder="Who's reading?"
              maxLength={24}
              className="td-input"
              style={{ width: "100%" }}
              autoComplete="nickname"
              autoCapitalize="words"
              enterKeyHint="next"
              aria-invalid={hostNameError}
              aria-describedby={hostNameError ? "host-name-error" : undefined}
            />
            {hostNameError && (
              <p className="field-error" id="host-name-error">
                Add your name to host the table.
              </p>
            )}
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="field-label" htmlFor="topic">
              First prompt <span style={{ fontVariant: "normal", letterSpacing: 0 }}>(optional)</span>
            </label>
            <textarea
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Things you'd never say at Thanksgiving."
              maxLength={280}
              rows={2}
              className="td-input"
              style={{
                width: "100%",
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 16,
                lineHeight: 1.35,
                resize: "vertical",
                minHeight: 64,
              }}
            />
          </div>

          {submitError && <p className="form-error">{submitError}</p>}

          <BtnPrimary disabled={creating} style={{ width: "100%" }} type="submit">
            {creating ? "Opening…" : "Open the table"}
          </BtnPrimary>

          <p className="lobby-help">
            This phone is the host. Everyone else opens the link and follows along — answers are written on paper.
          </p>
        </div>
      </form>

      <ol className="how-steps">
        <li>
          <span className="step-no">01</span>
          <h2>Seat the table</h2>
          <p>Add a name for each player. One person reads the prompt out loud.</p>
        </li>
        <li>
          <span className="step-no">02</span>
          <h2>Pass the link</h2>
          <p>Other phones follow the board. They don't type their answers.</p>
        </li>
        <li>
          <span className="step-no">03</span>
          <h2>Guess out loud</h2>
          <p>Mark someone out when they're matched. +1 for every correct guess.</p>
        </li>
      </ol>
    </div>
  );
}
