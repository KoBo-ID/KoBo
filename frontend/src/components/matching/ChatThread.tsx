import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flag, MessageCircle } from 'lucide-react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PartnerConnectionView, PartnerMessageView } from '@kobo/shared/types';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ErrorState } from '../ui/QueryState';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { BlockButton } from './BlockButton';
import { MatchEmptyState } from './EmptyState';
import { ReportDialog } from './ReportDialog';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { MATCH_BASE, formatChatTime, refusalMessage, useInvalidateMatching, usePageActive } from '../../lib/matching';
import '../../styles/matching.css';
import '../../styles/matching-chat.css';

const MAX = 1000;
const POLL_MS = 10_000;
const NEAR_BOTTOM_PX = 80;

const endedNotice = (c: PartnerConnectionView): string =>
  c.endReason === 'BLOCKED'
    ? 'Kamu sudah memblokir pengguna ini. Obrolan hanya bisa dibaca.'
    : c.endReason === 'PROFILE_DELETED'
      ? 'Obrolan ini hanya bisa dibaca karena profil lawan bicara sudah dihapus.'
      : 'Koneksi ini sudah berakhir, jadi obrolan hanya bisa dibaca.';

/**
 * One conversation: header actions, message history (older messages via "Pesan lebih lama"), live polling and the composer.
 * Prop: `connection` (PartnerConnectionView). Render it with `key={connection.id}` so state resets between conversations.
 * Polls every 10 s only while the tab is visible and focused, marks the thread read while it is, autoscrolls only when the
 * reader is already at the bottom, and announces new incoming messages in an aria-live="polite" region.
 */
export const ChatThread: React.FC<{ connection: PartnerConnectionView }> = ({ connection }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const invalidate = useInvalidateMatching();
  const active = usePageActive();
  const id = connection.id;
  const partner = connection.partner;

  const query = useInfiniteQuery({
    ...trpc.matching.message.list.infiniteQueryOptions({ connectionId: id, limit: 30 }, { getNextPageParam: (last) => last.nextCursor ?? undefined }),
    refetchInterval: active ? POLL_MS : false,
    retry: false,
  });
  // Page 0 is the newest slice; each page is oldest first, so reverse the pages to read top to bottom.
  const messages: PartnerMessageView[] = [];
  const seen = new Set<string>();
  for (const page of [...(query.data?.pages ?? [])].reverse()) {
    for (const m of page.items) if (!seen.has(m.id)) { seen.add(m.id); messages.push(m); }
  }
  const canSend = (query.data?.pages[0]?.canSend ?? false) && !connection.endedAt;
  const latestIncoming = [...messages].reverse().find((m) => !m.mine)?.id ?? null;

  // Scrolling: stay pinned to the bottom only when the reader already is there; keep position when older messages load.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restore = useRef<{ height: number; top: number } | null>(null);
  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  const loadOlder = () => {
    const el = scroller.current;
    if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop };
    void query.fetchNextPage();
  };

  // Mark read while the tab is visible. The first run only marks when the list says something is unread.
  const lastMarked = useRef<string | null>(null);
  const firstRun = useRef(true);
  const markRead = useMutation({
    ...trpc.matching.message.markRead.mutationOptions(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trpc.matching.message.unreadCount.queryKey() });
      void qc.invalidateQueries({ queryKey: trpc.matching.connection.list.queryKey() });
    },
  });
  const { mutate: markReadNow } = markRead;
  useEffect(() => {
    if (!active || !query.isSuccess) return;
    // The first successful load settles `firstRun` even when the thread is empty, so a message that arrives later by
    // polling is marked read (it previously hit the "initial" branch and was skipped).
    const initial = firstRun.current;
    firstRun.current = false;
    if (!latestIncoming || lastMarked.current === latestIncoming) return;
    if (initial && connection.unread === 0) { lastMarked.current = latestIncoming; return; }
    lastMarked.current = latestIncoming;
    markReadNow({ connectionId: id });
  }, [active, query.isSuccess, latestIncoming, connection.unread, id, markReadNow]);

  // Screen reader announcement of new incoming messages (not the initial load).
  const known = useRef<Set<string> | null>(null);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!query.isSuccess) return;
    if (known.current === null) { known.current = new Set(seen); return; }
    const fresh = messages.filter((m) => !known.current!.has(m.id) && !m.mine);
    for (const m of messages) known.current.add(m.id);
    if (fresh.length) setAnnounce(`Pesan baru dari ${partner.displayName}: ${fresh[fresh.length - 1]!.body}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, query.isSuccess]);

  // Composer.
  const [text, setText] = useState('');
  const [confirmBody, setConfirmBody] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const send = useMutation({
    ...trpc.matching.message.send.mutationOptions(),
    onSuccess: (res, vars) => {
      if (!res.sent) { setConfirmBody(vars.body); return; }
      setText('');
      setConfirmBody(null);
      setSendError(null);
      pinned.current = true;
      void query.refetch();
      void qc.invalidateQueries({ queryKey: trpc.matching.connection.list.queryKey() });
    },
    onError: (e) => { setConfirmBody(null); setSendError(refusalMessage(e)); },
  });
  const submit = (confirmContact?: boolean) => {
    const body = (confirmBody ?? text).trim();
    if (!body || body.length > MAX || send.isPending) return;
    setSendError(null);
    send.mutate({ connectionId: id, body, ...(confirmContact ? { confirmContact: true } : {}) });
  };

  // Header actions.
  const [endOpen, setEndOpen] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [report, setReport] = useState<{ messageId?: string } | null>(null);
  const end = useMutation({
    ...trpc.matching.connection.end.mutationOptions(),
    onSuccess: () => { setEndOpen(false); void invalidate(); },
    onError: (e) => setEndError(messageForError(e)),
  });
  const live = !connection.endedAt;
  const profileId = partner.profileId;

  return (
    <section className="mc-thread" aria-label={`Obrolan dengan ${partner.displayName}`}>
      <header className="mc-thread__head">
        <h2 className="mc-thread__name">{partner.displayName}</h2>
        <div className="mt-row">
          {live && <Link to={`${MATCH_BASE}/kos/${id}`} className="mc-link">Cari kos bersama</Link>}
          {live && <Button size="sm" variant="outline" onClick={() => { setEndError(null); setEndOpen(true); }}>Akhiri koneksi</Button>}
          {profileId && <Button size="sm" variant="ghost" icon={<Flag size={14} />} onClick={() => setReport({})}>Laporkan</Button>}
          {profileId && connection.endReason !== 'BLOCKED' && <BlockButton profileId={profileId} displayName={partner.displayName} variant="ghost" />}
        </div>
      </header>

      <div className="mc-thread__body" ref={scroller} onScroll={onScroll} aria-busy={query.isFetching}>
        {query.isPending && (
          <div className="mt-stack" aria-label="Memuat pesan">
            <Skeleton height="2.5rem" width="60%" borderRadius="var(--radius-lg)" />
            <Skeleton height="2.5rem" width="45%" borderRadius="var(--radius-lg)" style={{ alignSelf: 'flex-end' }} />
            <Skeleton height="2.5rem" width="55%" borderRadius="var(--radius-lg)" />
          </div>
        )}
        {query.isError && <ErrorState message={messageForError(query.error)} onRetry={() => void query.refetch()} minHeight="10rem" />}
        {query.isSuccess && (
          <>
            {query.hasNextPage && (
              <div className="mc-older">
                <Button size="sm" variant="outline" isLoading={query.isFetchingNextPage} onClick={loadOlder}>Pesan lebih lama</Button>
              </div>
            )}
            {messages.length === 0 && (
              <MatchEmptyState icon={<MessageCircle size={36} />} title="Sapa calon teman sekamarmu">
                Mulai dengan perkenalan singkat: jurusan, jam kuliah, dan kebiasaan di kos. Jangan bagikan nomor atau tautan sebelum kamu nyaman.
              </MatchEmptyState>
            )}
            <ol className="mc-msgs">
              {messages.map((m) => (
                <li key={m.id} className="mc-msg" data-mine={m.mine}>
                  <p className="mc-msg__body">{m.body}</p>
                  <span className="mc-msg__meta">
                    {formatChatTime(m.createdAt)}
                    {!m.mine && profileId && (
                      <button type="button" className="mc-msg__report" onClick={() => setReport({ messageId: m.id })} aria-label={`Laporkan pesan dari ${partner.displayName}`}>
                        Laporkan
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
      <div className="mc-sr" role="status" aria-live="polite">{announce}</div>

      {query.isSuccess && (canSend ? (
        <form className="mc-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {confirmBody && (
            <div className="mc-warn" role="alert">
              <p><strong>Yakin bagikan kontak?</strong> Bagikan hanya jika sudah nyaman.</p>
              <div className="mt-row">
                <Button type="button" size="sm" variant="primary" isLoading={send.isPending} onClick={() => submit(true)}>Kirim</Button>
                <Button type="button" size="sm" variant="outline" disabled={send.isPending} onClick={() => setConfirmBody(null)}>Batal</Button>
              </div>
            </div>
          )}
          {sendError && <Notice tone="error">{sendError}</Notice>}
          <label htmlFor={`chat-${id}`} className="mc-sr">Tulis pesan</label>
          <textarea
            id={`chat-${id}`}
            className="mt-textarea mc-input"
            rows={2}
            value={text}
            readOnly={send.isPending}
            maxLength={MAX}
            placeholder="Tulis pesan. Enter untuk kirim, Shift+Enter untuk baris baru."
            aria-describedby={`chat-${id}-count`}
            onChange={(e) => { setText(e.target.value); if (confirmBody) setConfirmBody(null); if (sendError) setSendError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
          />
          <div className="mc-composer__foot">
            <span id={`chat-${id}-count`} className="mt-counter" aria-live="off">{text.length}/{MAX}</span>
            <Button type="submit" size="md" variant="primary" isLoading={send.isPending} disabled={send.isPending || !text.trim()}>Kirim</Button>
          </div>
        </form>
      ) : (
        <p className="mc-readonly" role="note">{connection.endedAt ? endedNotice(connection) : 'Obrolan ini hanya bisa dibaca saat ini.'}</p>
      ))}

      {endOpen && (
        <ConfirmDialog
          title="Akhiri koneksi?"
          message={
            <>
              Obrolan menjadi hanya-baca dan daftar kos bersama dibekukan. Kamu bisa mengajak orang lain lagi setelahnya.
              {endError && <span style={{ display: 'block', marginTop: '0.75rem' }}><Notice tone="error">{endError}</Notice></span>}
            </>
          }
          confirmLabel="Akhiri koneksi"
          danger
          busy={end.isPending}
          onConfirm={() => { setEndError(null); end.mutate({ connectionId: id }); }}
          onCancel={() => setEndOpen(false)}
        />
      )}
      {report && profileId && (
        <ReportDialog profileId={profileId} displayName={partner.displayName} connectionId={id} messageId={report.messageId} onClose={() => setReport(null)} />
      )}
    </section>
  );
};
