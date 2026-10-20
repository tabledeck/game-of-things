import { useState, useCallback, useRef, useEffect, type CSSProperties, type ChangeEvent } from "react";
import { data } from "react-router";
import type { Route } from "./+types/game.$gameId";
import { getPrisma } from "~/db.server";
import { useGameWebSocket } from "@tabledeck/game-room/client";
import { readGuestCookie } from "@tabledeck/game-room/server";
import type { GotState } from "~/domain/types";

import BtnPrimary from "~/components/tabledeck/BtnPrimary";
import BtnSecondary from "~/components/tabledeck/BtnSecondary";
import Plaque from "~/components/tabledeck/Plaque";
import Pin from "~/components/icons/Pin";
import TrashIcon from "~/components/icons/TrashIcon";
import LinkIcon from "~/components/icons/LinkIcon";
import PlusIcon from "~/components/icons/PlusIcon";
import CloseIcon from "~/components/icons/CloseIcon";

export function meta({ data: loaderData }: Route.MetaArgs) {
  const hostName = (loaderData as { hostName?: string } | undefined)?.hostName || "Host";
  return [{ title: `The Game of Things — ${hostName}'s table` }];
}

const PIN_ROTATIONS = [-2.2, 1.6, -1.1, 2.1, -1.6, 1.1, -2.0, 1.8, -0.7, 1.4];

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { gameId } = params;
  const db = getPrisma(context);

  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) throw data({ error: "Game not found" }, { status: 404 });

  const identity = readGuestCookie(request, `got_${gameId}`);
  const isHost = identity?.seat === 0;
  const myName = identity?.name ?? "Spectator";

  const env = (context as { cloudflare?: { env?: Env } }).cloudflare?.env;
  let initialState: GotState | null = null;
  if (env) {
    try {
      const doId = env.GOT_ROOM.idFromName(gameId);
      const stub = env.GOT_ROOM.get(doId);
      const res = await stub.fetch(new Request("http://internal/state"));
      if (res.ok) {
        const body = (await res.json()) as { state: GotState };
        initialState = body.state;
      }
    } catch {
      // WS connect will hydrate state
    }
  }

  const url = new URL(request.url);
  const shareUrl = `${url.protocol}//${url.host}/game/${gameId}`;

  return {
    gameId,
    hostName: game.hostName,
    isHost,
    myName,
    mySeat: isHost ? 0 : -1,
    initialState,
    shareUrl,
  };
}

type ModalState =
  | null
  | { type: "reset-round" }
  | { type: "reset-scores" }
  | { type: "remove"; name: string };

type Conn = "connecting" | "live" | "reconnecting";

export default function GameRoom({ loaderData }: Route.ComponentProps) {
  const { gameId, hostName, isHost, myName, mySeat, initialState, shareUrl } = loaderData;

  const [gotState, setGotState] = useState<GotState | null>(initialState);
  const [liveShareUrl, setLiveShareUrl] = useState(shareUrl);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [conn, setConn] = useState<Conn>(initialState ? "live" : "connecting");
  const [hostOnline, setHostOnline] = useState(true);
  const toastTimer = useRef<number | null>(null);
  const lastHeard = useRef(initialState ? Date.now() : 0);
  const socketReady = useRef(false);
  const connRef = useRef<Conn>(initialState ? "live" : "connecting");
  const mountedAt = useRef(Date.now());

  const flash = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  const markHeard = useCallback(() => {
    lastHeard.current = Date.now();
    socketReady.current = true;
    if (connRef.current !== "live") {
      connRef.current = "live";
      setConn("live");
    }
  }, []);

  const { send } = useGameWebSocket({
    gameId,
    seat: mySeat,
    name: myName,
    onMessage: useCallback(
      (rawMsg: unknown) => {
        const msg = rawMsg as {
          type?: string;
          message?: string;
          seat?: number;
          state?: GotState;
        };
        if (msg.type === "pong" || msg.type === "state_updated" || msg.type === "game_state") {
          markHeard();
        }
        if (msg.type === "state_updated" || msg.type === "game_state") {
          if (msg.state) setGotState(msg.state);
        } else if (msg.type === "error" && msg.message) {
          flash(msg.message);
        } else if (msg.type === "player_disconnected" && msg.seat === 0) {
          setHostOnline(false);
        } else if (msg.type === "player_joined" && msg.seat === 0) {
          setHostOnline(true);
          markHeard();
        }
      },
      [flash, markHeard],
    ),
  });

  useEffect(() => {
    setLiveShareUrl(`${window.location.origin}/game/${gameId}`);
  }, [gameId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      send({ type: "ping" });
      const heard = lastHeard.current;
      const quiet = heard ? Date.now() - heard > 12000 : Date.now() - mountedAt.current > 8000;
      if (quiet && connRef.current !== "reconnecting") {
        connRef.current = "reconnecting";
        setConn("reconnecting");
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [send]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(liveShareUrl);
      flash("Link copied");
    } catch {
      flash("Select the link and copy it");
      document.getElementById("share-link")?.focus();
    }
  };

  const shareLink = async () => {
    const payload = {
      title: "The Game of Things",
      text: `Follow ${hostName}'s table`,
      url: liveShareUrl,
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copyLink();
  };

  const topic = gotState?.topic ?? "";
  const players = gotState?.players ?? [];
  const notes = gotState?.notes ?? "";
  const ready = gotState !== null;

  const guarded = (fn: () => void) => {
    if (!socketReady.current || connRef.current === "reconnecting") {
      flash("Still connecting — try again in a moment");
      return;
    }
    fn();
  };

  return (
    <>
      <div id="table-root" className="table-page" inert={modal ? true : undefined}>
        <header className="masthead">
          <Plaque style={{ padding: "12px 18px" }}>
            <div className="mast-title">
              <a className="mast-home" href="https://tabledeck.us">
                Tabledeck
              </a>
              <h1>The Game of Things</h1>
              <span className="mast-host">Hosted by {hostName}</span>
            </div>
          </Plaque>

          <div className="mast-actions">
            <span className="live-pill" data-state={conn}>
              <span className="live-dot" aria-hidden="true" />
              {conn === "live" ? "Live" : conn === "connecting" ? "Connecting" : "Reconnecting"}
            </span>
            {isHost ? (
              <BtnSecondary type="button" onClick={() => setModal({ type: "reset-round" })} disabled={!ready}>
                Next round
              </BtnSecondary>
            ) : (
              <div className="td-ticket follow-chip" style={{ cursor: "default" }}>
                <span style={{ fontFamily: "var(--serif)", fontVariant: "small-caps", letterSpacing: "0.14em", fontSize: 13 }}>
                  Following
                </span>
              </div>
            )}
          </div>
        </header>

        <RoundStatus
          isHost={isHost}
          hostName={hostName}
          hostOnline={hostOnline || isHost}
          ready={ready}
          topic={topic}
          players={players}
        />

        <PromptCard
          topic={topic}
          isHost={isHost && ready}
          onSetTopic={(t) => guarded(() => send({ type: "set_topic", topic: t }))}
        />

        <section className="share-bar" aria-label="Share this table">
          <div>
            <p className="share-label">Pass this link around</p>
            <input
              id="share-link"
              className="share-link"
              readOnly
              value={liveShareUrl}
              aria-label="Link to this table"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          <div className="share-actions">
            <BtnSecondary type="button" onClick={() => void copyLink()}>
              <LinkIcon size={16} />
              Copy
            </BtnSecondary>
            <BtnPrimary type="button" onClick={() => void shareLink()}>
              Share
            </BtnPrimary>
          </div>
        </section>

        {isHost && ready && (
          <AddPlayerForm
            players={players}
            onAdd={(name) => guarded(() => send({ type: "add_player", name }))}
          />
        )}

        <PlayerBoard
          players={players}
          isHost={isHost && ready}
          onToggle={(name) => guarded(() => send({ type: "toggle_player", name }))}
          onRemove={(name) => setModal({ type: "remove", name })}
          onScore={(name, delta) => guarded(() => send({ type: "increment_score", name, delta }))}
        />

        <Scoreboard
          players={players}
          isHost={isHost && ready}
          onResetScores={() => setModal({ type: "reset-scores" })}
        />

        <NotesSection
          notes={notes}
          isHost={isHost && ready}
          onSetNotes={(n) => send({ type: "set_notes", notes: n })}
        />

        <footer className="table-foot">
          <a href="https://tabledeck.us">Tabledeck</a>
          <a href="/">Leave</a>
          <span>Made for the table</span>
        </footer>
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {toast ?? ""}
      </div>
      {toast && (
        <div className="td-toast-stamp" aria-hidden="true">
          {toast}
        </div>
      )}

      {modal?.type === "reset-round" && (
        <ResetRoundModal
          onCancel={() => setModal(null)}
          onConfirm={(clearNotes) => {
            guarded(() => {
              send({ type: "reset_round" });
              if (clearNotes) send({ type: "set_notes", notes: "" });
            });
            setModal(null);
          }}
        />
      )}
      {modal?.type === "reset-scores" && (
        <ConfirmModal
          title="Reset every score?"
          body="Points go back to zero. Names, the prompt, and who's in or out stay as they are."
          confirmLabel="Reset scores"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            guarded(() => send({ type: "reset_scores" }));
            setModal(null);
          }}
        />
      )}
      {modal?.type === "remove" && (
        <ConfirmModal
          title={`Remove ${modal.name}?`}
          body="They leave the table and their score goes with them. You can add them again, starting from zero."
          confirmLabel="Remove"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            guarded(() => send({ type: "remove_player", name: modal.name }));
            setModal(null);
          }}
        />
      )}
    </>
  );
}

function RoundStatus({
  isHost,
  hostName,
  hostOnline,
  ready,
  topic,
  players,
}: {
  isHost: boolean;
  hostName: string;
  hostOnline: boolean;
  ready: boolean;
  topic: string;
  players: { name: string; isOut: boolean }[];
}) {
  const active = players.filter((p) => !p.isOut);
  const outCount = players.length - active.length;

  let tone: "next" | "wait" | "play" | "last" | "warn" = "next";
  let title = "Connecting to the table";
  let body = "Hang on while the board catches up.";

  if (!ready) {
    tone = "wait";
  } else if (!isHost && !hostOnline) {
    tone = "warn";
    title = "Host stepped away";
    body = "The board pauses until they open the table again.";
  } else if (players.length === 0) {
    tone = isHost ? "next" : "wait";
    title = isHost ? "Seat the table" : "Waiting for the host";
    body = isHost
      ? "Add everyone who's playing, then pass the link. Answers are written on paper."
      : `${hostName} will add the players. Write on paper when the prompt is read.`;
  } else if (!topic.trim()) {
    tone = isHost ? "next" : "wait";
    title = isHost ? "Set the prompt" : "Waiting for a prompt";
    body = isHost
      ? players.length < 3
        ? "Read it out loud. Three or more players makes the guess better, but you can start with whoever's here."
        : "Read it out loud. Nobody types an answer here."
      : "When the host reads the prompt, write your answer on paper.";
  } else if (active.length === 1 && players.length > 1) {
    tone = "last";
    title = `${active[0].name} is the last one in`;
    body = isHost
      ? "Give points for the correct guesses, then start the next round."
      : "One answer still hasn't been matched.";
  } else if (active.length === 0) {
    tone = "next";
    title = "Everyone is out";
    body = isHost ? "Start the next round when the table is ready." : "Waiting for the next round.";
  } else {
    tone = "play";
    title = isHost ? `${active.length} still in${outCount ? ` · ${outCount} out` : ""}` : "Guessing in progress";
    body = isHost
      ? "Tap Still in to knock someone out. +1 when a guess is right. Pass the guess around the table."
      : "Keep your answer on paper. This screen updates as the host marks guesses.";
  }

  return (
    <section className="status-banner" data-tone={tone} aria-live="polite">
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

function PromptCard({
  topic,
  isHost,
  onSetTopic,
}: {
  topic: string;
  isHost: boolean;
  onSetTopic: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(topic);

  useEffect(() => {
    if (!editing) setDraft(topic);
  }, [topic, editing]);

  const commitEdit = () => {
    setEditing(false);
    if (draft.trim() !== topic) onSetTopic(draft.trim());
  };

  const cancelEdit = () => {
    setDraft(topic);
    setEditing(false);
  };

  return (
    <section className="prompt-wrap">
      <div className="td-card prompt-card">
        <div className="prompt-kicker">
          <span className="sc">Prompt</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {isHost && !editing && (
              <button type="button" className="text-btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <div className="prompt-seal" aria-hidden="true">
              Things
            </div>
          </div>
        </div>

        {isHost && editing ? (
          <>
            <textarea
              className="prompt-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                }
                if (e.key === "Escape") cancelEdit();
              }}
              autoFocus
              rows={2}
              maxLength={280}
              placeholder="What should everyone write about?"
              aria-label="Prompt"
            />
            <div className="prompt-actions">
              <BtnSecondary type="button" onClick={cancelEdit}>
                Cancel
              </BtnSecondary>
              <BtnPrimary type="button" onClick={commitEdit}>
                Save prompt
              </BtnPrimary>
            </div>
          </>
        ) : isHost ? (
          <button
            type="button"
            className={`prompt-text${topic ? "" : " is-empty"}`}
            onClick={() => setEditing(true)}
          >
            {topic || "Tap to set a prompt"}
          </button>
        ) : (
          <p className={`prompt-text prompt-static${topic ? "" : " is-empty"}`}>
            {topic || "No prompt yet"}
          </p>
        )}

        {!topic.trim() && !draft.trim() && (
          <p className="prompt-hint">e.g. — what you'd regret the moment it leaves your mouth</p>
        )}
        <div className="prompt-rule" aria-hidden="true" />
      </div>
    </section>
  );
}

function PlayerBoard({
  players,
  isHost,
  onToggle,
  onRemove,
  onScore,
}: {
  players: { name: string; isOut: boolean; score: number }[];
  isHost: boolean;
  onToggle: (name: string) => void;
  onRemove: (name: string) => void;
  onScore: (name: string, delta: number) => void;
}) {
  if (!players.length) {
    return (
      <div className="empty-table">
        <p>{isHost ? "Names you add will pin up here." : "The host hasn't seated anyone yet."}</p>
      </div>
    );
  }

  const active = players.filter((p) => !p.isOut);

  return (
    <div className="player-grid">
      {players.map((player, i) => (
        <PlayerCard
          key={player.name}
          name={player.name}
          isOut={player.isOut}
          isLast={!player.isOut && active.length === 1 && players.length > 1}
          score={player.score ?? 0}
          rotIndex={i}
          isHost={isHost}
          onToggle={() => onToggle(player.name)}
          onRemove={() => onRemove(player.name)}
          onScore={(delta) => onScore(player.name, delta)}
        />
      ))}
    </div>
  );
}

function PlayerCard({
  name,
  isOut,
  isLast,
  score,
  rotIndex,
  isHost,
  onToggle,
  onRemove,
  onScore,
}: {
  name: string;
  isOut: boolean;
  isLast: boolean;
  score: number;
  rotIndex: number;
  isHost: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onScore: (delta: number) => void;
}) {
  const rot = PIN_ROTATIONS[rotIndex % PIN_ROTATIONS.length];

  return (
    <article
      className={`player-card td-pinned${isOut ? " is-out" : ""}${isLast ? " is-last" : ""}`}
      style={{ "--pin-rot": `${rot}deg` } as CSSProperties}
    >
      <div className="player-pin" aria-hidden="true">
        <Pin size={20} color={isOut ? "#6b5344" : "#c8372a"} />
      </div>
      <div className="player-main">
        <h3 className={`player-name${isOut ? " is-out" : ""}`}>{name}</h3>
        {isLast && <p className="player-last">last one in</p>}
      </div>
      <div className={`player-controls${isHost ? " is-host" : ""}`}>
        {isHost ? (
          <button
            type="button"
            className={`status-btn${isOut ? " is-out" : ""}`}
            aria-pressed={isOut}
            aria-label={`${name}, ${isOut ? "out" : "still in"}. ${isOut ? "Mark still in" : "Knock out"}`}
            onClick={onToggle}
          >
            {isOut ? "Out" : "Still in"}
          </button>
        ) : (
          <span className={`status-btn${isOut ? " is-out" : ""}`} aria-label={`${name} is ${isOut ? "out" : "still in"}`}>
            {isOut ? "Out" : "Still in"}
          </span>
        )}
        <div className="score-row">
          {isHost && (
            <button
              type="button"
              className="score-btn"
              aria-label={`Remove a point from ${name}`}
              disabled={score <= 0}
              onClick={() => onScore(-1)}
            >
              −
            </button>
          )}
          <span className="score-val" aria-label={`${score} ${score === 1 ? "point" : "points"}`}>
            {score}
            <span className="score-unit"> pts</span>
          </span>
          {isHost && (
            <button
              type="button"
              className="score-btn"
              aria-label={`Award a point to ${name}`}
              onClick={() => onScore(1)}
            >
              +
            </button>
          )}
        </div>
        {isHost && (
          <button type="button" className="remove-btn" aria-label={`Remove ${name}`} onClick={onRemove}>
            <TrashIcon size={16} />
            <span className="remove-label">Remove</span>
          </button>
        )}
      </div>
    </article>
  );
}

function Scoreboard({
  players,
  isHost,
  onResetScores,
}: {
  players: { name: string; score: number }[];
  isHost: boolean;
  onResetScores: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (!players.length) return null;

  const ranked = [...players].sort((a, b) => {
    const s = (b.score ?? 0) - (a.score ?? 0);
    return s !== 0 ? s : a.name.localeCompare(b.name);
  });
  const top = ranked[0]?.score ?? 0;

  return (
    <section className="score-section" style={{ marginTop: 8 }}>
      <div className="td-card" style={{ background: "#fdf8f0", padding: "8px 16px 14px", borderRadius: 9 }}>
        <div className="section-head">
          <button
            type="button"
            className="section-toggle"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="got-scoreboard-body"
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            Scores
          </button>
          <div className="rule" aria-hidden="true" />
          {isHost && open && (
            <button type="button" className="text-btn" onClick={onResetScores}>
              Reset scores
            </button>
          )}
        </div>
        {open && (
          <ol id="got-scoreboard-body" className="score-list">
            {ranked.map((p) => {
              const leading = top > 0 && (p.score ?? 0) === top;
              return (
                <li key={p.name}>
                  <span className="who">
                    {p.name}
                    {leading ? " · lead" : ""}
                  </span>
                  <span className={`pts${leading ? " lead" : ""}`}>{p.score ?? 0}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function AddPlayerForm({
  players,
  onAdd,
}: {
  players: { name: string }[];
  onAdd: (name: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) {
      setError("Type a name first.");
      document.getElementById("add-player-input")?.focus();
      return;
    }
    if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setError("That name is already at the table.");
      return;
    }
    setError("");
    onAdd(name);
    setNewName("");
  };

  return (
    <form
      className="add-player"
      onSubmit={(e) => {
        e.preventDefault();
        handleAdd();
      }}
    >
      <div className="name-field">
        <label className="field-label" htmlFor="add-player-input">
          Add a player
        </label>
        <input
          id="add-player-input"
          type="text"
          placeholder="Name at the table"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            if (error) setError("");
          }}
          className="td-input"
          style={{ width: "100%" }}
          maxLength={24}
          autoCapitalize="words"
          enterKeyHint="done"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "add-player-error" : undefined}
        />
        {error && (
          <p className="add-error" id="add-player-error">
            {error}
          </p>
        )}
      </div>
      <BtnPrimary type="submit">
        <PlusIcon size={16} />
        Add
      </BtnPrimary>
    </form>
  );
}

function NotesSection({
  notes,
  isHost,
  onSetNotes,
}: {
  notes: string;
  isHost: boolean;
  onSetNotes: (n: string) => void;
}) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditingRef = useRef(false);
  const [localNotes, setLocalNotes] = useState(notes);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!isEditingRef.current) setLocalNotes(notes);
  }, [notes]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLocalNotes(val);
    isEditingRef.current = true;
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSetNotes(val);
      isEditingRef.current = false;
    }, 250);
  };

  const covered = !isHost && !revealed && localNotes.trim().length > 0;

  return (
    <section className="notes-section">
      <div className="td-scroll">
        <div className="section-head" style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid rgba(42,31,22,0.15)" }}>
          <h2>Round notes</h2>
          <div className="rule" aria-hidden="true" />
        </div>
        <p className="notes-hint">
          {isHost
            ? "Everyone with the link can open these. Leave them blank during the guess if you don't want to spoil who said what."
            : "The host's scratch pad. Covered until you ask to see it."}
        </p>
        {isHost ? (
          <textarea
            className="td-notebook"
            placeholder="Jot a reminder after the round…"
            value={localNotes}
            onChange={handleChange}
            maxLength={10000}
            rows={4}
            aria-label="Round notes"
          />
        ) : covered ? (
          <div className="notes-cover">
            <p>Notes are covered so the round isn't spoiled.</p>
            <BtnSecondary type="button" onClick={() => setRevealed(true)}>
              Show notes
            </BtnSecondary>
          </div>
        ) : (
          <div className="td-notebook-readonly" aria-label="Round notes">
            {localNotes || (
              <span style={{ fontFamily: "var(--script)", fontSize: 18, color: "var(--ink-soft)" }}>
                Nothing written yet.
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function useDialog(onCancel: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const previously = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const focusables = () =>
      [...(dialog?.querySelectorAll<HTMLElement>("button, [href], input, textarea, select") ?? [])].filter(
        (el) => !el.hasAttribute("disabled"),
      );
    dialog?.setAttribute("tabindex", "-1");
    (dialog?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previously?.focus();
    };
  }, []);

  return ref;
}

function ResetRoundModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (clearNotes: boolean) => void;
}) {
  const [clearNotes, setClearNotes] = useState(false);
  const ref = useDialog(onCancel);

  return (
    <div
      className="modal-scroll-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-round-title"
        ref={ref}
      >
        <div className="modal-card-body">
          <div className="modal-title-row">
            <h3 id="reset-round-title">Next round?</h3>
            <button type="button" className="icon-hit" aria-label="Close" onClick={onCancel}>
              <CloseIcon size={18} />
            </button>
          </div>
          <p className="modal-copy">
            Everyone is marked still in again. Scores and the prompt stay. Change the prompt if this round needs a new one.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={clearNotes}
              onChange={(e) => setClearNotes(e.target.checked)}
            />
            <span className="check-box" aria-hidden="true" />
            Also clear the notes
          </label>
          <div className="modal-actions">
            <BtnSecondary type="button" data-autofocus onClick={onCancel}>
              Cancel
            </BtnSecondary>
            <BtnPrimary type="button" onClick={() => onConfirm(clearNotes)}>
              Next round
            </BtnPrimary>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useDialog(onCancel);
  const titleId = "confirm-title";

  return (
    <div
      className="modal-scroll-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal-scroll" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-card-body">
          <div className="modal-title-row">
            <h3 id={titleId}>{title}</h3>
            <button type="button" className="icon-hit" aria-label="Close" onClick={onCancel}>
              <CloseIcon size={18} />
            </button>
          </div>
          <p className="modal-copy">{body}</p>
          <div className="modal-actions">
            <BtnSecondary type="button" data-autofocus onClick={onCancel}>
              Cancel
            </BtnSecondary>
            <BtnPrimary type="button" onClick={onConfirm}>
              {confirmLabel}
            </BtnPrimary>
          </div>
        </div>
      </div>
    </div>
  );
}
