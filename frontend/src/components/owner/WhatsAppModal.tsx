import React, { useState } from 'react';
import { MessageSquare, Copy, ExternalLink, Heart } from 'lucide-react';
import type { BoardRoom } from '../../../../backend/src/trpc/router';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/AppContext';
import { useSession } from '../../lib/session';
import { formatDueDate, formatRupiah } from '../../lib/ownerWorkspace';

interface WhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: BoardRoom | null;
  kosName: string;
}

export const WhatsAppModal: React.FC<WhatsAppModalProps> = ({
  isOpen,
  onClose,
  room,
  kosName,
}) => {
  const { addToast } = useAppStore();
  const { me } = useSession();
  const ownerName = me?.user.name ?? 'pengelola';
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState<'santun' | 'resmi'>('santun');

  if (!room) return null;

  const cleanPhone = (phone: string = '') => {
    let p = phone.replace(/[^0-9]/g, '');
    if (p.startsWith('0')) {
      p = '62' + p.substring(1);
    }
    return p;
  };

  const getMessageTemplate = () => {
    const tenantName = room.tenant?.name ?? '';
    const tenantFirstName = tenantName ? tenantName.split(' ')[0] : 'Kak';
    const amount = formatRupiah(room.invoice?.amount ?? room.priceMonthly);
    const due = formatDueDate(room.invoice?.dueDate);
    const late = room.daysOverdue > 0 ? ` (terlambat ${room.daysOverdue} hari)` : '';
    const link = `${window.location.origin}/my-kos`;

    if (tone === 'santun') {
      return `Halo Kak ${tenantFirstName}, salam hangat dari ${ownerName} (${kosName}) yaa.

Semoga perkuliahan dan aktivitasnya di ${room.tenant?.campus || 'kampus'} berjalan lancar selalu.

Sekadar mengingatkan santun ya Kak, tagihan sewa kamar *Nomor ${room.roomNumber}* sebesar *${amount}* jatuh tempo pada tanggal ${due}${late}.

Rincian tagihan dan kuitansi Kakak bisa dilihat di ${link}

Kalau sudah membayar atau ada kendala tanggal kiriman uang saku, kabari kami ya Kak. Kuitansi digital terbit begitu pembayaran kami catat.

Terima kasih banyak atas kerjasamanya Kak ${tenantFirstName}!`;
    }

    return `Yth. Sdr/i ${tenantName || 'Penghuni'},

Kami dari pengelola ${kosName} memberitahukan bahwa tagihan sewa Kamar No. ${room.roomNumber} sebesar ${amount} jatuh tempo pada tanggal ${due}${late}.

Rincian tagihan dan kuitansi tersedia di ${link}

Mohon kabari kami setelah pembayaran dilakukan. Terima kasih atas perhatian dan kerjasamanya.`;
  };

  const messageText = getMessageTemplate();
  const phone = cleanPhone(room.tenant?.phone ?? '');
  // Without a recorded number wa.me still opens WhatsApp and lets the owner pick the contact.
  const waLink = `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    addToast('Template pesan WhatsApp santun berhasil disalin!', 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <MessageSquare size={20} color="#25D366" />
          <span>Pengingat WhatsApp Santun</span>
        </div>
      }
      subtitle={`Kirim pengingat sewa tanpa rasa canggung ke ${room.tenant?.name ?? 'penghuni'} (Kamar ${room.roomNumber})`}
      maxWidth="md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Value Callout */}
        <div
          style={{
            backgroundColor: 'hsl(142, 60%, 95%)',
            border: '1px solid hsl(142, 50%, 85%)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            fontSize: '0.8125rem',
            color: 'hsl(142, 71%, 35%)',
            fontWeight: 600,
          }}
        >
          <Heart size={18} style={{ flexShrink: 0 }} />
          <span>
            Bebas rasa canggung! Format pesan disusun dengan etika kesantunan khas mahasiswa & pemilik kos Indonesia.
          </span>
        </div>

        {/* Tone Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
            Gaya Bahasa Pesan:
          </span>
          <button
            type="button"
            onClick={() => setTone('santun')}
            className="interactive-tap"
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-btn)',
              fontSize: '0.785rem',
              fontWeight: tone === 'santun' ? 700 : 500,
              backgroundColor: tone === 'santun' ? 'var(--primary)' : 'var(--bg-muted)',
              color: tone === 'santun' ? 'white' : 'var(--text-muted)',
              border: 'none',
            }}
          >
            Hangat & Santun (Rekomendasi)
          </button>
          <button
            type="button"
            onClick={() => setTone('resmi')}
            className="interactive-tap"
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-btn)',
              fontSize: '0.785rem',
              fontWeight: tone === 'resmi' ? 700 : 500,
              backgroundColor: tone === 'resmi' ? 'var(--primary)' : 'var(--bg-muted)',
              color: tone === 'resmi' ? 'white' : 'var(--text-muted)',
              border: 'none',
            }}
          >
            Formal / Resmi
          </button>
        </div>

        {/* Message Preview Box */}
        <div>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
            Pratinjau Pesan yang Akan Dikirim:
          </label>
          <div
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
              fontSize: '0.875rem',
              lineHeight: 1.6,
              color: 'var(--text-main)',
              whiteSpace: 'pre-line',
              fontFamily: 'var(--font-sans)',
              maxHeight: '220px',
              overflowY: 'auto',
            }}
          >
            {messageText}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.5rem' }}>
          <Button variant="outline" size="sm" onClick={handleCopy} icon={<Copy size={15} />}>
            {copied ? 'Tersalin!' : 'Salin Teks Pesan'}
          </Button>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Tutup
            </Button>
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <Button
                type="button"
                variant="primary"
                size="sm"
                icon={<ExternalLink size={15} />}
                style={{ backgroundColor: '#25D366', borderColor: '#25D366' }}
              >
                Buka WhatsApp (wa.me)
              </Button>
            </a>
          </div>
        </div>
      </div>
    </Modal>
  );
};
