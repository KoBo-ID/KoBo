import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
}

const openModals: HTMLElement[] = [];

function isTopModal(dialog: HTMLElement | null): boolean {
  if (!dialog) return false;
  const leaves = openModals.filter((m) => !openModals.some((other) => other !== m && m.contains(other)));
  return leaves[leaves.length - 1] === dialog;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'md',
  showCloseButton = true,
}) => {
  // Prevent background scroll and compensate for scrollbar width
  useScrollLock(isOpen);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus moves into the dialog, Tab stays inside it, and focus returns to what opened it.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog) openModals.push(dialog);
    const focusables = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    (dialog?.querySelector<HTMLElement>('[autofocus], input:not([disabled]), textarea:not([disabled])') ?? focusables()[0] ?? dialog)?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopModal(dialog)) return;
      const items = focusables();
      if (items.length === 0) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog || !dialog?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      if (dialog) {
        const idx = openModals.lastIndexOf(dialog);
        if (idx !== -1) openModals.splice(idx, 1);
      }
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen]);

  // ESC listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopModal(dialogRef.current)) {
        e.stopImmediatePropagation();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthMap: Record<string, string> = {
    sm: '420px',
    md: '540px',
    lg: '720px',
    xl: '920px',
  };

  return (
    <div
      onClick={onClose}
      className="kobo-modal-backdrop animate-fade-in"
    >
      <div
        style={{ maxWidth: maxWidthMap[maxWidth], zIndex: 'var(--z-modal)' }}
        onClick={(e) => e.stopPropagation()}
        className="kobo-modal animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        ref={dialogRef}
        tabIndex={-1}
      >
        {/* Modal Header */}
        {(title || showCloseButton) && (
          <div className="kobo-modal__header">
            <div>
              {title && (
                <h3 id={titleId} style={{ fontSize: 'var(--step-1)', fontWeight: 700, color: 'var(--text-main)' }}>
                  {title}
                </h3>
              )}
              {subtitle && (
                <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  {subtitle}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup modal"
                className="kobo-modal__close interactive-tap"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        {/* Modal Body */}
        <div className="kobo-modal__body">
          {children}
        </div>
      </div>
    </div>
  );
};
