import React from 'react';
import { Link } from 'react-router-dom';
import type { PartnerConnectionView } from '@kobo/shared/types';
import { MATCH_BASE, formatChatTime } from '../../lib/matching';
import '../../styles/matching.css';
import '../../styles/matching-chat.css';

/**
 * The list of connections in Pesan. Props: `connections` (newest activity first); `activeId` marks the open conversation.
 * Each row links to /teman-sekamar/pesan/:id and shows the partner name, the time of the last message, the unread count
 * and an "Berakhir" tag when the connection ended.
 */
export const ConversationList: React.FC<{ connections: PartnerConnectionView[]; activeId?: string }> = ({ connections, activeId }) => (
  <ul className="mc-convs" aria-label="Percakapan">
    {connections.map((c) => {
      const ended = !!c.endedAt;
      const when = c.lastMessage?.createdAt ?? c.createdAt;
      return (
        <li key={c.id}>
          <Link
            to={`${MATCH_BASE}/pesan/${c.id}`}
            className="mc-conv"
            aria-current={c.id === activeId ? 'page' : undefined}
          >
            <span className="mc-conv__main">
              <span className="mc-conv__name">{c.partner.displayName}</span>
              <span className="mc-conv__last">
                {c.lastMessage ? `${c.lastMessage.mine ? 'Kamu: ' : ''}${c.lastMessage.body}` : 'Belum ada pesan'}
              </span>
            </span>
            <span className="mc-conv__side">
              <span className="mt-small mt-muted">{formatChatTime(when)}</span>
              {ended && <span className="mc-tag" data-tone="off">Berakhir</span>}
              {c.unread > 0 && <span className="mt-count" aria-label={`${c.unread} pesan belum dibaca`}>{c.unread > 99 ? '99+' : c.unread}</span>}
            </span>
          </Link>
        </li>
      );
    })}
  </ul>
);
