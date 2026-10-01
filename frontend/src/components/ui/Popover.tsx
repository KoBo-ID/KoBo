import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

interface TriggerProps {
  ref: React.Ref<HTMLButtonElement>;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog' | 'menu';
  'aria-controls': string | undefined;
  onClick: () => void;
}

interface PopoverProps {
  /** Renders the trigger. Spread the supplied props onto a <button>. */
  trigger: (props: TriggerProps) => React.ReactNode;
  /** Panel contents. `close` dismisses the panel and returns focus to the trigger. */
  children: (api: { close: () => void }) => React.ReactNode;
  /** Which edge the panel aligns to. Defaults to 'right'. */
  align?: 'left' | 'right';
  /** Semantic role of the panel. 'menu' for a list of actions, 'dialog' for a form. */
  role?: 'dialog' | 'menu';
  /** Accessible name for the panel. */
  label?: string;
  /** Extra classes on the panel, e.g. 'kobo-menu'. */
  panelClassName?: string;
  /** Extra classes on the anchor. The anchor is inline-flex by default, so a
   *  trigger with width:100% sizes to the anchor's own content, not its
   *  column - pass 'kobo-popover-anchor--block' to make it fill instead. */
  anchorClassName?: string;
}

/**
 * Anchored popover panel.
 *
 * Owns its own open state and the three behaviours an anchored overlay must
 * have to be usable without a mouse: Escape closes it, an outside pointer
 * press closes it, and closing returns focus to the trigger that opened it.
 *
 * Positioning and appearance come from `.kobo-popover` in styles/components.css.
 */
export const Popover: React.FC<PopoverProps> = ({
  trigger,
  children,
  align = 'right',
  role = 'dialog',
  label,
  panelClassName,
  anchorClassName,
}) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger so keyboard users do not lose their place.
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // Outside press: dismiss without stealing focus back, so the click lands
      // where the user aimed it.
      setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  return (
    <div className={`kobo-popover-anchor${anchorClassName ? ' ' + anchorClassName : ''}`}>
      {trigger({
        ref: triggerRef,
        'aria-expanded': open,
        'aria-haspopup': role,
        'aria-controls': open ? panelId : undefined,
        onClick: () => setOpen((prev) => !prev),
      })}

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role={role}
          aria-label={label}
          className={[
            'kobo-popover',
            align === 'left' ? 'kobo-popover--left' : '',
            'animate-slide-up',
            panelClassName ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {children({ close })}
        </div>
      )}
    </div>
  );
};
